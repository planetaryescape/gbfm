import { sql } from 'drizzle-orm'
import { Effect, Match, Schema } from 'effect'

import { Database } from '@/db/layer'

import { McpToolError } from '../contracts'
import { type MusicEditChange, MusicRevision, musicEditReference } from './commands'

const Credit = Schema.Struct({
  artistId: Schema.String.check(Schema.isMaxLength(200)),
  name: Schema.String.check(Schema.isMaxLength(500)),
  role: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))),
  displayOrder: Schema.Int,
})

const Snapshot = Schema.Struct({
  revision: MusicRevision,
  referenceRevision: Schema.NullOr(MusicRevision),
  metadata: Schema.Record(
    Schema.String,
    Schema.Union([Schema.String.check(Schema.isMaxLength(10_000)), Schema.Number, Schema.Null]),
  ),
  genres: Schema.Array(Schema.String.check(Schema.isMaxLength(100))).check(Schema.isMaxLength(200)),
  credits: Schema.Array(Credit).check(Schema.isMaxLength(200)),
  labels: Schema.Array(Schema.String.check(Schema.isMaxLength(200))).check(Schema.isMaxLength(200)),
  albumType: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
  albumId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
  referenceExists: Schema.Boolean,
  referenceName: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
})

const unavailable = () =>
  new McpToolError({ code: 'unavailable', message: 'Music metadata preview is unavailable.' })

// SQLite BINARY compares UTF-8 bytes, not JavaScript's UTF-16 code units.
const compareSqliteBinary = (left: string, right: string): number => {
  const encoder = new TextEncoder()
  const a = encoder.encode(left)
  const b = encoder.encode(right)

  for (const [index, byte] of a.entries()) {
    const other = b[index]

    if (other === undefined) return 1

    if (byte !== other) return byte - other
  }

  return a.length - b.length
}

export const musicEditTarget = (change: MusicEditChange) => {
  switch (change.operation) {
    case 'set_album_type':
      return { entityType: 'album' as const, entityId: change.entityId }
    case 'set_track_album':
      return { entityType: 'track' as const, entityId: change.entityId }
    default:
      return { entityType: change.entityType, entityId: change.entityId }
  }
}

// Table/column identifiers below come exclusively from this closed map. Values
// remain bound parameters. One SELECT observes the target and every reference.
const tables = {
  artist: 'music_artists',
  album: 'music_albums',
  track: 'music_tracks',
  label: 'music_labels',
} as const

export const planMusicEdit = Effect.fn('MusicEdit.plan')(function* (change: MusicEditChange) {
  const db = yield* Database
  const target = musicEditTarget(change)
  const kind = target.entityType
  const table = sql.identifier(tables[kind])
  const reference = musicEditReference(change)
  const referenceTable = reference ? sql.identifier(tables[reference.entityType]) : table

  const creditTable = sql.identifier(
    kind === 'album' ? 'music_album_artists' : 'music_track_artists',
  )

  const creditParent = sql.identifier(kind === 'album' ? 'albumId' : 'trackId')

  const affiliationTable = sql.identifier(
    kind === 'artist' ? 'music_label_artists' : 'music_label_albums',
  )

  const affiliationParent = sql.identifier(kind === 'artist' ? 'artist_id' : 'album_id')

  const metadata = Match.value(kind).pipe(
    Match.when('artist', () => sql`json_object('name', e.name, 'bio', e.bio)`),
    Match.when('album', () => sql`json_object('title', e.title, 'releaseDate', e.releaseDate)`),
    Match.when('track', () => sql`json_object('title', e.title, 'trackNumber', e.trackNumber)`),
    Match.when('label', () => sql`json_object('name', e.name, 'description', e.description)`),
    Match.exhaustive,
  )

  const creditProjection =
    kind === 'album' || kind === 'track'
      ? sql`(SELECT json_group_array(json_object('artistId', artistId, 'name', name,
          'role', role, 'displayOrder', displayOrder)) FROM (
          SELECT c.artistId, a.name, c.role, c.displayOrder FROM ${creditTable} c
          JOIN music_artists a ON a.id = c.artistId WHERE c.${creditParent} = e.id
          ORDER BY c.displayOrder, c.artistId LIMIT 201))`
      : sql`'[]'`

  const labelProjection =
    kind === 'artist' || kind === 'album'
      ? sql`(SELECT json_group_array(label_id) FROM (
          SELECT label_id FROM ${affiliationTable} WHERE ${affiliationParent} = e.id
          ORDER BY label_id LIMIT 201))`
      : sql`'[]'`

  const row = yield* Effect.tryPromise({
    try: () =>
      db.get<{ snapshot: string }>(sql`SELECT json_object(
        'revision', e.revision,
        'referenceRevision', ${reference ? sql`(SELECT revision FROM ${referenceTable} WHERE id = ${reference.entityId})` : sql`NULL`},
        'metadata', json(${metadata}),
        'genres', json((SELECT json_group_array(name) FROM (
          SELECT l.name FROM entity_labels el JOIN labels l ON l.id = el.label_id
          WHERE el.entity_type = ${kind === 'label' ? 'musicLabel' : kind}
          AND el.entity_id = e.id AND l.kind = 'genre'
          ORDER BY el.position, l.id LIMIT 201))),
        'credits', json(${creditProjection}),
        'labels', json(${labelProjection}),
        'albumType', ${kind === 'album' ? sql`e.albumType` : sql`NULL`},
        'albumId', ${kind === 'track' ? sql`e.albumId` : sql`NULL`},
        'referenceExists', json(${reference ? sql`CASE WHEN EXISTS (SELECT 1 FROM ${referenceTable} WHERE id = ${reference.entityId}) THEN 'true' ELSE 'false' END` : sql`'true'`}),
        'referenceName', ${reference?.entityType === 'artist' ? sql`(SELECT name FROM music_artists WHERE id = ${reference.entityId})` : sql`NULL`}
      ) AS snapshot FROM ${table} e WHERE e.id = ${change.entityId}`),
    catch: unavailable,
  })

  if (!row) {
    return yield* new McpToolError({ code: 'not_found', message: 'Music entity not found.' })
  }

  const snapshot = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Snapshot))(
    row.snapshot,
  ).pipe(Effect.mapError(unavailable))

  if (!snapshot.referenceExists) {
    return yield* new McpToolError({ code: 'not_found', message: 'Music entity not found.' })
  }

  let field: string
  let before: Schema.Json
  let after: Schema.Json

  switch (change.operation) {
    case 'set_album_type':
      field = 'albumType'
      before = snapshot.albumType
      after = change.albumType
      break
    case 'set_track_album':
      field = 'albumId'
      before = snapshot.albumId
      after = change.albumId
      break
    case 'update_music_metadata': {
      field = 'metadata'

      const observed = Object.fromEntries(
        Object.keys(change.metadata).map((key) => [key, snapshot.metadata[key] ?? null]),
      )

      after = { ...change.metadata }

      if (change.entityType === 'album' && change.metadata.releaseDate !== undefined) {
        const date = yield* Schema.decodeUnknownEffect(
          Schema.NullOr(
            Schema.Number.check(
              Schema.isBetween({ minimum: -8_640_000_000_000_000, maximum: 8_640_000_000_000_000 }),
            ),
          ),
        )(snapshot.metadata.releaseDate ?? null).pipe(Effect.mapError(unavailable))

        observed.releaseDate = date === null ? null : new Date(date).toISOString()
      }

      before = observed
      break
    }

    case 'set_music_genres':
      field = 'genres'
      before = [...snapshot.genres]
      after = [...change.genres]
      break
    case 'set_artist_credit':
    case 'remove_artist_credit': {
      field = 'credits'
      before = [...snapshot.credits]
      const credits = snapshot.credits.filter((credit) => credit.artistId !== change.artistId)

      if (change.operation === 'set_artist_credit') {
        if (snapshot.referenceName === null) return yield* unavailable()
        credits.push({
          artistId: change.artistId,
          name: snapshot.referenceName,
          role: change.role,
          displayOrder: change.displayOrder,
        })
      }

      credits.sort(
        (a, b) => a.displayOrder - b.displayOrder || compareSqliteBinary(a.artistId, b.artistId),
      )

      if (credits.length > 200) return yield* unavailable()
      after = credits
      break
    }

    case 'set_label_affiliation':
    case 'remove_label_affiliation': {
      field = 'labelIds'
      before = [...snapshot.labels]
      const labels = snapshot.labels.filter((id) => id !== change.labelId)

      if (change.operation === 'set_label_affiliation') labels.push(change.labelId)

      if (labels.length > 200) return yield* unavailable()
      after = labels.sort(compareSqliteBinary)
      break
    }
  }

  return {
    target,
    reference,
    revision: snapshot.revision,
    references:
      reference && snapshot.referenceRevision !== null
        ? [{ ...reference, expectedRevision: snapshot.referenceRevision }]
        : [],
    field,
    before,
    after,
    changed: JSON.stringify(before) !== JSON.stringify(after),
  }
})
