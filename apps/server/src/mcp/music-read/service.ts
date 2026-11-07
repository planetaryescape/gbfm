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
  MusicRef,
  type MusicRelationshipsInput,
  MusicRelationshipsResult,
  type SearchMusicInput,
} from './contracts'

// D3: timestamps do not gate these four kinds. Label content is deliberately never selected.
const entities = sql`select 'artist' as entityType, id as entityId, name, slug, updatedAt from music_artists
  union all select 'album', id, title, slug, updatedAt from music_albums
  union all select 'track', id, title, slug, updatedAt from music_tracks
  union all select 'label', id, name, slug, updated_at from music_labels`

const edges = sql`select 'album_artist' as relationship, 'album' as fromType, albumId as fromId,
  'artist' as toType, artistId as toId, role, displayOrder as position from music_album_artists
  union all select 'track_artist', 'track', trackId, 'artist', artistId, role, displayOrder from music_track_artists
  union all select 'label_artist', 'label', label_id, 'artist', artist_id, null, null from music_label_artists
  union all select 'label_album', 'label', label_id, 'album', album_id, null, null from music_label_albums
  union all select 'album_track', 'album', albumId, 'track', id, null, trackNumber from music_tracks where albumId is not null`

const StoredEntity = Schema.Struct({
  ...MusicRef.fields,
  name: Schema.String,
  slug: Schema.String,
  updatedAt: Schema.Number,
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

  const bounded = <A>(value: A) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength > 256 * 1024
      ? Effect.fail(
          new EditorialToolError({
            code: 'unavailable',
            message: 'Music result exceeds 256 KiB. Request a smaller page or batch.',
          }),
        )
      : Effect.succeed(value)

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
      sql`with entities as (${entities}) select * from entities
      where entityType = ${ref.entityType} and entityId = ${ref.entityId} limit 1`,
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

  const list = Effect.fn('MusicRead.list')(function* (
    input: typeof SearchMusicInput.Type | typeof FilterMusicInput.Type,
  ) {
    yield* authorization.catalogue
    const limit = input.limit ?? 20
    const offset = input.offset ?? 0

    const match =
      'query' in input
        ? sql`instr(lower(name), lower(${input.query})) > 0`
        : input.name === undefined
          ? sql`1`
          : sql`lower(name) = lower(${input.name})`

    const rows = yield* query(
      sql`with entities as (${entities}) select * from entities
      where ${input.entityType === undefined ? sql`1` : sql`entityType = ${input.entityType}`} and ${match}
      order by entityType, entityId limit ${limit + 1} offset ${offset}`,
      StoredEntity,
    )

    return yield* bounded({
      endpoint,
      entities: yield* Effect.forEach(rows.slice(0, limit), project),
      pagination: { limit, offset, hasMore: rows.length > limit },
    })
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

    const [ref] = yield* query(
      sql`select i.entity_type as entityType, i.entity_id as entityId
      from music_source_identities i where i.state = 'resolved'
      and i.entity_type in ('artist', 'album', 'track', 'label')
      and (i.source_key = ${source.sourceKey} or i.canonical_url = ${source.canonicalUrl}
        or i.source_key in (select source_key from music_source_aliases where normalized_url = ${source.normalizedUrl}))
      order by i.source_key limit 1`,
      MusicRef,
    )

    const row = ref ? yield* load(ref) : undefined

    return yield* bounded({
      endpoint,
      result: row
        ? { status: 'found' as const, entity: yield* project(row) }
        : { status: 'not_found' as const },
    })
  })

  const relationships = Effect.fn('MusicRead.relationships')(function* (
    input: typeof MusicRelationshipsInput.Type,
    mode: 'all' | 'discography' | 'tracks' | 'catalogue' = 'all',
  ) {
    yield* authorization.catalogue

    if (!(yield* load(input))) return yield* notFound()
    const limit = input.limit ?? 20
    const offset = input.offset ?? 0

    const selected = Match.value(mode).pipe(
      Match.when('all', () => sql`1`),
      Match.when('discography', () => sql`relationship in ('album_artist', 'track_artist')`),
      Match.when('tracks', () => sql`relationship = 'album_track'`),
      Match.when('catalogue', () => sql`relationship in ('label_artist', 'label_album')`),
      Match.exhaustive,
    )

    const rows = yield* query(
      sql`with entities as (${entities}), edges as (${edges}), related as (
      select relationship, toType as entityType, toId as entityId, role, position, 'outgoing' as direction
      from edges where fromType = ${input.entityType} and fromId = ${input.entityId}
      union all select relationship, fromType, fromId, role, position, 'incoming'
      from edges where toType = ${input.entityType} and toId = ${input.entityId}
    ) select e.*, r.relationship, r.role, r.position, r.direction from related r
      inner join entities e on e.entityType = r.entityType and e.entityId = r.entityId
      where ${selected}
      order by ${mode === 'tracks' ? sql`r.position is null, r.position,` : sql``}
        r.relationship, e.entityType, e.entityId limit ${limit + 1} offset ${offset}`,
      Schema.Struct({
        ...StoredEntity.fields,
        relationship: MusicRelationshipsResult.fields.relationships.value.fields.relationship,
        direction: Schema.Literals(['outgoing', 'incoming']),
        role: Schema.NullOr(Schema.String),
        position: Schema.NullOr(Schema.Int),
      }),
    )

    const related = yield* Effect.forEach(rows.slice(0, limit), (row) =>
      Effect.gen(function* () {
        return {
          relationship: row.relationship,
          direction: row.direction,
          role: row.role,
          position: row.position,
          entity: yield* project(row),
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
    searchMusic: (input: typeof SearchMusicInput.Type) => list(input),
    filterMusic: (input: typeof FilterMusicInput.Type) => list(input),
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
