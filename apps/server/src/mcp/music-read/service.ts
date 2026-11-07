import { sql } from 'drizzle-orm'
import { Context, Effect, Layer, Match, Schema } from 'effect'

import { Database } from '@/db/layer'
import { parseMusicSource } from '@/services/canonical-music-identity/music-source'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EditorialToolError, EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import {
  type AlbumTracksInput,
  type ArtistDiscographyInput,
  type FilterMusicInput,
  type GetMusicEntitiesInput,
  type LabelCatalogueInput,
  type LookupMusicUrlInput,
  MusicEntity,
  MusicKind,
  MusicRef,
  type MusicRelationshipsInput,
  MusicRelationshipsResult,
  type SearchMusicInput,
  SearchMusicResult,
} from './contracts'

// D3: timestamps do not gate these four kinds. Label content is deliberately never selected.
const musicRows = {
  artist: sql`select 'artist' as entityType, id as entityId, name, slug, updatedAt from music_artists`,
  album: sql`select 'album' as entityType, id as entityId, title as name, slug, updatedAt from music_albums`,
  track: sql`select 'track' as entityType, id as entityId, title as name, slug, updatedAt from music_tracks`,
  label: sql`select 'label' as entityType, id as entityId, name, slug, updated_at as updatedAt from music_labels`,
}

const StoredEntity = Schema.Struct({
  ...MusicRef.fields,
  name: Schema.String,
  slug: Schema.String,
  updatedAt: Schema.Number,
})

const searchPolicy = Schema.decodeUnknownSync(
  Schema.Struct({
    candidates: Schema.Int.check(Schema.isGreaterThan(0)),
    matchBytes: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
)({ candidates: 8192, matchBytes: 256 * 1024 })

const SearchSelection = Schema.Struct({
  status: Schema.Literals(['complete', 'budget_exhausted']),
  hasMore: Schema.Literals([0, 1]),
  rows: Schema.fromJsonString(Schema.Array(StoredEntity)),
  firstOpen: Schema.NullOr(MusicKind),
  byteGap: Schema.Literals([0, 1]),
})

const unavailable = () =>
  new EditorialToolError({ code: 'unavailable', message: 'Music catalogue unavailable.' })

const notFound = () =>
  new EditorialToolError({ code: 'not_found', message: 'Music entity not found.' })

const makeService = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  const query = <A>(statement: ReturnType<typeof sql>, schema: Schema.Codec<A, unknown>) =>
    Effect.tryPromise({ try: () => db.all(statement), catch: unavailable }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(schema))),
      Effect.mapError(unavailable),
    )

  const bounded = <A>(value: A) => {
    // Effect 4.0.6 emits both structuredContent and its JSON text. Measure both,
    // including string escaping; reserve 24KiB for framing and IDs within read-only
    // admission (16KiB). Write-capable grants admit larger requests: oversized echoed
    // IDs can still hit the central full-envelope ceiling instead of this guidance.
    const encoded = JSON.stringify({
      isError: false,
      structuredContent: value,
      content: [{ type: 'text', text: JSON.stringify(value) }],
    })

    return new TextEncoder().encode(encoded).byteLength > 232 * 1024
      ? Effect.fail(
          new EditorialToolError({
            code: 'unavailable',
            message:
              'Music result exceeds the 256 KiB MCP response budget. Request a smaller page or batch.',
          }),
        )
      : Effect.succeed(value)
  }

  const project = Effect.fn('MusicRead.project')(function* (row: typeof StoredEntity.Type) {
    const links = yield* query(
      sql`select platform, url from music_entity_links
      where entity_type = ${row.entityType} and entityId = ${row.entityId}
      and status = 'verified' order by platform, id limit 21`,
      Schema.Struct({ platform: Schema.String, url: Schema.String }),
    )

    // Existing rows can contain arbitrary URLs. Never expose credentials or private destinations.
    const safeLinks = yield* Effect.forEach(links.slice(0, 20), (link) =>
      parseMusicSource(link.url).pipe(
        Effect.map((source) => [{ platform: link.platform, url: source.canonicalUrl }]),
        Effect.orElseSucceed(() => []),
      ),
    )

    return yield* Schema.decodeUnknownEffect(MusicEntity)({
      entityType: row.entityType,
      entityId: row.entityId,
      name: row.name,
      slug: row.slug,
      observedUpdatedAt: new Date(row.updatedAt).toISOString(),
      links: safeLinks.flat(),
      linksHasMore: links.length > 20,
    }).pipe(Effect.mapError(unavailable))
  })

  const load = Effect.fn('MusicRead.load')(function* (ref: typeof MusicRef.Type) {
    const [row] = yield* query(
      sql`select * from (${musicRows[ref.entityType]}) where entityId = ${ref.entityId} limit 1`,
      StoredEntity,
    )

    return row
  })

  const getMusicEntity = Effect.fn('MusicRead.getMusicEntity')(function* (
    input: typeof MusicRef.Type,
  ) {
    yield* authorization.catalogue
    const row = yield* load(input)

    if (!row) return yield* notFound()

    return yield* bounded({ endpoint, entity: yield* project(row) })
  })

  const getMusicEntities = Effect.fn('MusicRead.getMusicEntities')(function* (
    input: typeof GetMusicEntitiesInput.Type,
  ) {
    yield* authorization.catalogue

    const results = yield* Effect.forEach(input.entities, (ref) =>
      Effect.gen(function* () {
        const row = yield* load(ref)

        return row
          ? { status: 'found' as const, ref, entity: yield* project(row) }
          : { status: 'not_found' as const, ref }
      }),
    )

    return yield* bounded({ endpoint, results })
  })

  const filterMusic = Effect.fn('MusicRead.filterMusic')(function* (
    input: typeof FilterMusicInput.Type,
  ) {
    yield* authorization.catalogue
    const limit = input.limit ?? 20
    const offset = input.offset ?? 0

    const match = input.name === undefined ? sql`1` : sql`lower(name) = lower(${input.name})`

    const rows = yield* query(
      sql`select * from (${musicRows[input.entityType]})
      where ${match}
      order by entityId
      limit ${limit + 1} offset ${offset}`,
      StoredEntity,
    )

    return yield* bounded({
      endpoint,
      entities: yield* Effect.forEach(rows.slice(0, limit), project),
      pagination: { limit, offset, hasMore: rows.length > limit },
    })
  })

  const searchMusic = Effect.fn('MusicRead.searchMusic')(function* (
    input: typeof SearchMusicInput.Type,
  ) {
    yield* authorization.catalogue
    const limit = input.limit ?? 20
    const offset = input.offset ?? 0

    const kinds = (['album', 'artist', 'label', 'track'] as const).filter(
      (kind) => input.entityType === undefined || kind === input.entityType,
    )

    const quotas = kinds.map(
      (_, i) =>
        Math.floor(searchPolicy.candidates / kinds.length) +
        (i < searchPolicy.candidates % kinds.length ? 1 : 0),
    )

    const prefix = (i: number) => sql.identifier(`p${i}`)

    // LIMIT precedes the unchanged matcher. All gap/EOF/page proof shares one statement.
    // These caps bound selected records and admitted match input, not fetched bytes or CPU.
    const [selection] = yield* query(
      sql`with
      cfg(query,byte_limit,lim,off) as materialized (
        values(${input.query},${searchPolicy.matchBytes},${limit},${offset})
      ),
      ${sql.join(
        kinds.map(
          (kind, i) => sql`${prefix(i)} as materialized (
        select * from (${musicRows[kind]}) order by entityId limit ${quotas[i]}
      )`,
        ),
        sql`,`,
      )},
      stats as materialized (${sql.join(
        kinds.map(
          (kind, i) =>
            sql`select ${kind} as kind,${quotas[i]} as quota,(select count(*) from ${prefix(i)}) as n`,
        ),
        sql` union all `,
      )}),
      boundary as materialized (select min(kind) as firstOpen from stats where n=quota),
      raw as materialized (${sql.join(
        kinds.map((_, i) => sql`select * from ${prefix(i)}`),
        sql` union all `,
      )}),
      usable as materialized (select * from raw where (select firstOpen from boundary) is null
        or entityType<=(select firstOpen from boundary)),
      charged as materialized (select *,sum(length(cast(name as blob))+
        length(cast((select query from cfg) as blob))) over(
          order by entityType,entityId rows between unbounded preceding and current row
        ) as charge from usable),
      admitted as materialized (select * from charged where charge<=(select byte_limit from cfg)),
      matched as materialized (select * from admitted where case
        when charge<=(select byte_limit from cfg)
        then instr(lower(name),lower((select query from cfg)))>0 else 0 end),
      proof as materialized (select
        (select count(*) from matched)>=(select off+lim+1 from cfg) as sentinel,
        (select firstOpen from boundary) is null and not exists(
          select 1 from charged where charge>(select byte_limit from cfg)
        ) as eof),
      page as materialized (select * from matched order by entityType,entityId
        limit (select lim from cfg) offset (select off from cfg))
      select case when sentinel or eof then 'complete' else 'budget_exhausted' end as status,
        case when sentinel then 1 else 0 end as hasMore,
        case when sentinel or eof then (select json_group_array(json_object(
          'entityType',entityType,'entityId',entityId,'name',name,'slug',slug,'updatedAt',updatedAt
        )) from (select * from page order by entityType,entityId)) else '[]' end as rows,
        (select firstOpen from boundary) as firstOpen,
        exists(select 1 from charged where charge>(select byte_limit from cfg)) as byteGap
      from proof`,
      SearchSelection,
    )

    if (
      !selection ||
      selection.rows.length > limit ||
      (selection.status === 'budget_exhausted' &&
        (selection.hasMore !== 0 ||
          selection.rows.length !== 0 ||
          (selection.firstOpen === null && !selection.byteGap))) ||
      (selection.status === 'complete' &&
        (selection.hasMore
          ? selection.rows.length !== limit
          : selection.firstOpen !== null || selection.byteGap !== 0))
    )
      return yield* unavailable()

    const result =
      selection.status === 'budget_exhausted'
        ? {
            status: 'budget_exhausted' as const,
            endpoint,
            requestedPage: { limit, offset },
            guidance:
              'Search budget exhausted; refine query, specify a kind, or lower the offset. Unchanged retries may exhaust again.' as const,
          }
        : {
            status: 'complete' as const,
            endpoint,
            entities: yield* Effect.forEach(selection.rows, project),
            pagination: { limit, offset, hasMore: selection.hasMore === 1 },
          }

    return yield* Schema.decodeUnknownEffect(SearchMusicResult)(result).pipe(
      Effect.mapError(unavailable),
      Effect.flatMap(bounded),
    )
  })

  const lookupMusicUrl = Effect.fn('MusicRead.lookupMusicUrl')(function* (
    input: typeof LookupMusicUrlInput.Type,
  ) {
    yield* authorization.catalogue

    const source = yield* parseMusicSource(input.url).pipe(
      Effect.mapError(
        () =>
          new EditorialToolError({ code: 'invalid_input', message: 'Invalid music source URL.' }),
      ),
    )

    const refs = yield* query(
      sql`select entity_type as entityType, entity_id as entityId from music_source_identities
        where source_key = ${source.sourceKey} and state = 'resolved'
        and entity_type in ('artist', 'album', 'track', 'label')
      union select entity_type, entity_id from music_source_identities
        where canonical_url = ${source.canonicalUrl} and state = 'resolved'
        and entity_type in ('artist', 'album', 'track', 'label')
      union select i.entity_type, i.entity_id from music_source_aliases a
        inner join music_source_identities i on i.source_key = a.source_key
        where a.normalized_url = ${source.normalizedUrl} and i.state = 'resolved'
        and i.entity_type in ('artist', 'album', 'track', 'label')
      order by entityType, entityId limit 3`,
      MusicRef,
    )

    for (const ref of refs) {
      const row = yield* load(ref)

      if (row)
        return yield* bounded({
          endpoint,
          result: { status: 'found' as const, entity: yield* project(row) },
        })
    }

    return yield* bounded({ endpoint, result: { status: 'not_found' as const } })
  })

  const relationships = Effect.fn('MusicRead.relationships')(function* (
    input: typeof MusicRelationshipsInput.Type,
    mode: 'all' | 'discography' | 'tracks' | 'catalogue' = 'all',
  ) {
    yield* authorization.catalogue

    if (!(yield* load(input))) return yield* notFound()
    const limit = input.limit ?? 20
    const offset = input.offset ?? 0

    // A row beyond p in a branch cannot enter the first p rows of the global order.
    // Drop constant relationship/kind sort keys inside each indexed branch.
    const prefix = (statement: ReturnType<typeof sql>, order = sql`entityId`) =>
      sql`select * from (${statement} order by ${order} limit ${offset + limit + 1})`

    const selected = Match.value(input.entityType).pipe(
      Match.when('artist', () => [
        prefix(sql`select 'album_artist' as relationship, 'album' as entityType, albumId as entityId,
            role, displayOrder as position, 'incoming' as direction
            from music_album_artists where artistId = ${input.entityId}`),
        prefix(sql`select 'track_artist' as relationship, 'track' as entityType, trackId as entityId,
            role, displayOrder as position, 'incoming' as direction
            from music_track_artists where artistId = ${input.entityId}`),
        ...(mode === 'all'
          ? [
              prefix(sql`select 'label_artist' as relationship, 'label' as entityType,
            label_id as entityId, null as role, null as position, 'incoming' as direction
            from music_label_artists where artist_id = ${input.entityId}`),
            ]
          : []),
      ]),
      Match.when('album', () => [
        prefix(
          sql`select 'album_track' as relationship, 'track' as entityType, id as entityId,
            null as role, trackNumber as position, 'outgoing' as direction
            from music_tracks where albumId = ${input.entityId}`,
          mode === 'tracks' ? sql`position is null, position, entityId` : sql`entityId`,
        ),
        ...(mode === 'all'
          ? [
              prefix(sql`select 'album_artist' as relationship, 'artist' as entityType, artistId as entityId,
              role, displayOrder as position, 'outgoing' as direction
              from music_album_artists where albumId = ${input.entityId}`),
              prefix(sql`select 'label_album' as relationship, 'label' as entityType, label_id as entityId,
              null as role, null as position, 'incoming' as direction
              from music_label_albums where album_id = ${input.entityId}`),
            ]
          : []),
      ]),
      Match.when('track', () => [
        prefix(sql`select 'track_artist' as relationship, 'artist' as entityType, artistId as entityId,
            role, displayOrder as position, 'outgoing' as direction
            from music_track_artists where trackId = ${input.entityId}`),
        prefix(sql`select 'album_track' as relationship, 'album' as entityType, albumId as entityId,
            null as role, trackNumber as position, 'incoming' as direction
            from music_tracks where id = ${input.entityId} and albumId is not null`),
      ]),
      Match.when('label', () => [
        prefix(sql`select 'label_artist' as relationship, 'artist' as entityType, artist_id as entityId,
            null as role, null as position, 'outgoing' as direction
            from music_label_artists where label_id = ${input.entityId}`),
        prefix(sql`select 'label_album' as relationship, 'album' as entityType, album_id as entityId,
            null as role, null as position, 'outgoing' as direction
            from music_label_albums where label_id = ${input.entityId}`),
      ]),
      Match.exhaustive,
    )

    const rows = yield* query(
      sql`select * from (${sql.join(selected, sql` union all `)})
      order by ${mode === 'tracks' ? sql`position is null, position,` : sql``}
        relationship, entityType, entityId limit ${limit + 1} offset ${offset}`,
      Schema.Struct({
        ...MusicRef.fields,
        relationship: MusicRelationshipsResult.fields.relationships.value.fields.relationship,
        direction: Schema.Literals(['outgoing', 'incoming']),
        role: Schema.NullOr(Schema.String),
        position: Schema.NullOr(Schema.Int),
      }),
    )

    const related = yield* Effect.forEach(rows.slice(0, limit), (row) =>
      Effect.gen(function* () {
        const entity = yield* load(row)

        if (!entity) return yield* unavailable()

        return {
          relationship: row.relationship,
          direction: row.direction,
          role: row.role,
          position: row.position,
          entity: yield* project(entity),
        }
      }),
    )

    return yield* bounded({
      endpoint,
      source: { entityType: input.entityType, entityId: input.entityId },
      relationships: related,
      pagination: { limit, offset, hasMore: rows.length > limit },
    })
  })

  return {
    getMusicEntity,
    getMusicEntities,
    lookupMusicUrl,
    searchMusic,
    filterMusic,
    getMusicRelationships: (input: typeof MusicRelationshipsInput.Type) => relationships(input),
    getArtistDiscography: (input: typeof ArtistDiscographyInput.Type) =>
      relationships({ ...input, entityType: 'artist', entityId: input.artistId }, 'discography'),
    getAlbumTracks: (input: typeof AlbumTracksInput.Type) =>
      relationships({ ...input, entityType: 'album', entityId: input.albumId }, 'tracks'),
    getLabelCatalogue: (input: typeof LabelCatalogueInput.Type) =>
      relationships({ ...input, entityType: 'label', entityId: input.labelId }, 'catalogue'),
  }
})

/** Authorized bounded catalogue reads over the existing migrated D1 schema. */
export class MusicReadService extends Context.Service<
  MusicReadService,
  Effect.Success<typeof makeService>
>()('gbfm/mcp/MusicReadService') {}

/** Requires Database and EditorialMcpConfig; never acquires provider/import/storage services. */
export const MusicReadServiceLayer = Layer.effect(MusicReadService, makeService).pipe(
  Layer.provide(McpAuthorizationLive),
)
