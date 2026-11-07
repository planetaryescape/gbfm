import { sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import { Database } from '@/db/layer'
import { auditMusicIdentities } from '@/services/canonical-music-identity/identity-maintenance'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EditorialToolError, EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { MusicKind, type MusicRef } from '../music-read/contracts'
import {
  CompareEntriesResult,
  type ConflictEvidence,
  ConflictResult,
  DuplicateResult,
  type EntryEvidence,
  IncompleteResult,
  QualitySummaryResult,
  type CompareEntriesInput,
  type ConflictInput,
  type DuplicateInput,
  type MissingField,
  type QualitySummaryInput,
  type QualityWindowInput,
} from './contracts'

const unavailable = () =>
  new EditorialToolError({ code: 'unavailable', message: 'Catalogue inspection unavailable.' })

const Row = Schema.Struct({
  entityType: MusicKind,
  entityId: Schema.String,
  name: Schema.String,
  nameTruncated: Schema.Number,
  missingName: Schema.Number,
  missingArtwork: Schema.Number,
  missingDescription: Schema.Number,
  missingReleaseDate: Schema.Number,
  missingAlbum: Schema.Number,
  missingArtistCredit: Schema.Number,
})

const catalogue = (kind: typeof MusicKind.Type) =>
  ({
    artist: {
      table: sql`music_artists`,
      name: sql`name`,
      artwork: sql`imageUrl`,
      description: sql`bio`,
      releaseDate: sql`1`,
      album: sql`1`,
      credit: sql`1`,
    },
    album: {
      table: sql`music_albums`,
      name: sql`title`,
      artwork: sql`coverImageUrl`,
      description: sql`1`,
      releaseDate: sql`releaseDate`,
      album: sql`1`,
      credit: sql`(select 1 from music_album_artists where albumId = e.id limit 1)`,
    },
    track: {
      table: sql`music_tracks`,
      name: sql`title`,
      artwork: sql`coverImageUrl`,
      description: sql`1`,
      releaseDate: sql`1`,
      album: sql`albumId`,
      credit: sql`(select 1 from music_track_artists where trackId = e.id limit 1)`,
    },
    label: {
      table: sql`music_labels`,
      name: sql`name`,
      artwork: sql`image_url`,
      description: sql`description`,
      releaseDate: sql`1`,
      album: sql`1`,
      credit: sql`1`,
    },
  })[kind]

const selection = (kind: typeof MusicKind.Type) => {
  const s = catalogue(kind)
  const absent = (column: ReturnType<typeof sql>) => sql`(${column} is null or trim(${column})='')`

  return sql`${kind} as entityType, id as entityId, substr(${s.name},1,200) as name,
    (length(${s.name})>200) as nameTruncated, ${absent(s.name)} as missingName,
    ${absent(s.artwork)} as missingArtwork, ${absent(s.description)} as missingDescription,
    (${s.releaseDate} is null) as missingReleaseDate, ${absent(s.album)} as missingAlbum,
    (${s.credit} is null) as missingArtistCredit`
}

const project = (row: typeof Row.Type): typeof EntryEvidence.Type => {
  const missingFields: Array<typeof MissingField.Type> = []

  if (row.missingName) missingFields.push('name')

  if (row.missingArtwork) missingFields.push('artwork')

  if (row.missingDescription) missingFields.push('description')

  if (row.missingReleaseDate) missingFields.push('release_date')

  if (row.missingAlbum) missingFields.push('album')

  if (row.missingArtistCredit) missingFields.push('artist_credit')

  return {
    entityType: row.entityType,
    entityId: row.entityId,
    name: row.name,
    nameTruncated: row.nameTruncated === 1,
    missingFields,
  }
}

const make = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  const authorize = authorization.highTrust('catalogue:inspect')

  const query = <A>(statement: ReturnType<typeof sql>, schema: Schema.Codec<A, unknown>) =>
    Effect.tryPromise({ try: () => db.all(statement), catch: unavailable }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(schema))),
      Effect.mapError(unavailable),
    )

  const response = <A>(schema: Schema.Codec<A, unknown>, value: NoInfer<A>) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(unavailable),
      Effect.flatMap((result) => {
        const bytes = new TextEncoder().encode(
          JSON.stringify({
            structuredContent: result,
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: false,
          }),
        ).byteLength

        return bytes <= 232 * 1024
          ? Effect.succeed(result)
          : Effect.fail(
              new EditorialToolError({
                code: 'unavailable',
                message: 'Inspection exceeds response budget. Request a smaller window.',
              }),
            )
      }),
    )

  const entry = (ref: typeof MusicRef.Type) =>
    query(
      sql`select ${selection(ref.entityType)} from ${catalogue(ref.entityType).table} e where id=${ref.entityId} limit 1`,
      Row,
    ).pipe(
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed(project(rows[0]))
          : Effect.fail(
              new EditorialToolError({ code: 'not_found', message: 'Catalogue entry not found.' }),
            ),
      ),
    )

  const window = (input: typeof QualityWindowInput.Type) =>
    query(
      sql`select ${selection(input.entityType)} from ${catalogue(input.entityType).table} e
      where id > ${input.afterId ?? ''} order by id limit ${(input.limit ?? 20) + 1}`,
      Row,
    ).pipe(
      Effect.map((rows) => ({
        entries: rows.slice(0, input.limit ?? 20).map(project),
        nextAfterId: rows.length > (input.limit ?? 20) ? (rows.at(-2)?.entityId ?? null) : null,
      })),
    )

  const findDuplicateCandidates = Effect.fn('CatalogueQuality.duplicates')(function* (
    input: typeof DuplicateInput.Type,
  ) {
    yield* authorize
    const seed = yield* entry(input)
    const s = catalogue(input.entityType)

    const rows = seed.missingFields.includes('name')
      ? []
      : yield* query(
          sql`select ${selection(input.entityType)} from ${s.table} e
        where lower(${s.name})=(select lower(${s.name}) from ${s.table} where id=${input.entityId})
        and id > ${input.afterId ?? ''} and id <> ${input.entityId}
        order by id limit ${(input.limit ?? 20) + 1}`,
          Row,
        )

    return yield* response(DuplicateResult, {
      endpoint,
      seed,
      candidates: rows.slice(0, input.limit ?? 20).map(project),
      evidence: 'same_kind_exact_sqlite_casefolded_name_hypothesis_only',
      nextAfterId: rows.length > (input.limit ?? 20) ? (rows.at(-2)?.entityId ?? null) : null,
    })
  })

  const compareMusicEntries = Effect.fn('CatalogueQuality.compare')(function* (
    input: typeof CompareEntriesInput.Type,
  ) {
    yield* authorize
    const left = yield* entry(input.left)
    const right = yield* entry(input.right)
    const l = catalogue(input.left.entityType)
    const r = catalogue(input.right.entityType)

    const [equality] = yield* query(
      sql`select
      ((select lower(${l.name}) from ${l.table} where id=${input.left.entityId}) =
       (select lower(${r.name}) from ${r.table} where id=${input.right.entityId})) as sameName`,
      Schema.Struct({ sameName: Schema.Number }),
    )

    return yield* response(CompareEntriesResult, {
      endpoint,
      left,
      right,
      sameCatalogueReference:
        input.left.entityType === input.right.entityType &&
        input.left.entityId === input.right.entityId,
      sameKind: input.left.entityType === input.right.entityType,
      sameCasefoldedName: equality?.sameName === 1,
      verdict: 'no_musical_equivalence_or_merge_verdict',
    })
  })

  const findIncompleteEntries = Effect.fn('CatalogueQuality.incomplete')(function* (
    input: typeof QualityWindowInput.Type,
  ) {
    yield* authorize
    const page = yield* window(input)

    return yield* response(IncompleteResult, {
      endpoint,
      entries: page.entries.filter((e) => e.missingFields.length > 0),
      scanned: page.entries.length,
      nextAfterId: page.nextAfterId,
    })
  })

  const listMusicIdentityConflicts = Effect.fn('CatalogueQuality.conflicts')(function* (
    input: typeof ConflictInput.Type,
  ) {
    yield* authorize

    const rows = yield* query(
      sql`select id, incumbent_entity_type as incumbentType, incumbent_entity_id as incumbentId,
      candidate_entity_type as candidateType, candidate_entity_id as candidateId, detected_at as detectedAt
      from music_source_identity_conflicts where status='open'
      and (detected_at,id) > (${input.after?.detectedAt ?? Number.MIN_SAFE_INTEGER},${input.after?.id ?? ''})
      order by detected_at,id limit ${(input.limit ?? 20) + 1}`,
      Schema.Struct({
        id: Schema.String,
        incumbentType: Schema.String,
        incumbentId: Schema.String,
        candidateType: Schema.String,
        candidateId: Schema.String,
        detectedAt: Schema.Number,
      }),
    )

    const page = rows.slice(0, input.limit ?? 20)
    const conflicts: Array<typeof ConflictEvidence.Type> = []

    for (const row of page) {
      const incumbentType = Schema.decodeUnknownOption(MusicKind)(row.incumbentType)
      const candidateType = Schema.decodeUnknownOption(MusicKind)(row.candidateType)

      // Unsupported kinds (including playlists) must still advance the examined-row cursor.
      if (Option.isSome(incumbentType) && Option.isSome(candidateType))
        conflicts.push({
          conflictId: row.id,
          incumbent: { entityType: incumbentType.value, entityId: row.incumbentId },
          candidate: { entityType: candidateType.value, entityId: row.candidateId },
          status: 'open',
          detectedAt: row.detectedAt,
          evidence: 'stored_identity_conflict_not_equality',
        })
    }

    const last = page.at(-1)

    return yield* response(ConflictResult, {
      endpoint,
      conflicts,
      scanned: page.length,
      nextAfter:
        rows.length > (input.limit ?? 20) && last
          ? { detectedAt: last.detectedAt, id: last.id }
          : null,
    })
  })

  const getCatalogueQualitySummary = Effect.fn('CatalogueQuality.summary')(function* (
    input: typeof QualitySummaryInput.Type,
  ) {
    yield* authorize
    const page = yield* window(input)

    const audit = yield* auditMusicIdentities(db, {
      phase: 'leases',
      batchSize: input.limit ?? 20,
      cursor: input.afterSourceKey,
    }).pipe(Effect.mapError(unavailable))

    return yield* response(QualitySummaryResult, {
      endpoint,
      scope: 'examined_windows_only_not_catalogue_totals',
      catalogue: {
        entityType: input.entityType,
        scanned: page.entries.length,
        incomplete: page.entries.filter((e) => e.missingFields.length > 0).length,
        nextAfterId: page.nextAfterId,
      },
      resolvingIdentities: {
        scanned: audit.scanned,
        active: audit.issues.filter((i) => i.category === 'resolving_lease').length,
        expired: audit.issues.filter((i) => i.category === 'expired_lease').length,
        complete: audit.complete,
        nextSourceKey: audit.complete ? null : audit.cursor,
      },
    })
  })

  return {
    findDuplicateCandidates,
    compareMusicEntries,
    findIncompleteEntries,
    listMusicIdentityConflicts,
    getCatalogueQualitySummary,
  }
})

export class CatalogueQualityService extends Context.Service<
  CatalogueQualityService,
  Effect.Success<typeof make>
>()('gbfm/mcp/CatalogueQuality') {}

export const CatalogueQualityServiceLayer = Layer.effect(CatalogueQualityService, make).pipe(
  Layer.provide(McpAuthorizationLive),
)
