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
const musicRows = {
  artist: sql`select 'artist' as entityType, id as entityId, name, slug, updatedAt from music_artists`,
  album: sql`select 'album' as entityType, id as entityId, title as name, slug, updatedAt from music_albums`,
  track: sql`select 'track' as entityType, id as entityId, title as name, slug, updatedAt from music_tracks`,
  label: sql`select 'label' as entityType, id as entityId, name, slug, updated_at as updatedAt from music_labels`,
}

const entities = sql.join(Object.values(musicRows), sql` union all `)

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

  const bounded = <A>(value: A) => {
    // Effect 4.0.6 emits both structuredContent and its JSON text. Measure both,
    // including string escaping; reserve 24KiB for the <=16KiB read request ID and framing.
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
      sql`select * from (${input.entityType === undefined ? entities : musicRows[input.entityType]})
      where ${match}
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

    // Predicates belong on each base table: a multiply referenced global edge CTE
    // materializes the entire catalogue before applying the source ID restriction.
    const selected = Match.value(input.entityType).pipe(
      Match.when(
        'artist',
        () => sql`
        select 'album_artist' as relationship, 'album' as entityType, albumId as entityId,
          role, displayOrder as position, 'incoming' as direction from music_album_artists where artistId = ${input.entityId}
        union all select 'track_artist', 'track', trackId, role, displayOrder, 'incoming'
          from music_track_artists where artistId = ${input.entityId}
        ${
          mode === 'all'
            ? sql`union all select 'label_artist', 'label', label_id, null, null, 'incoming'
          from music_label_artists where artist_id = ${input.entityId}`
            : sql``
        }`,
      ),
      Match.when(
        'album',
        () => sql`
        select 'album_track' as relationship, 'track' as entityType, id as entityId,
          null as role, trackNumber as position, 'outgoing' as direction from music_tracks where albumId = ${input.entityId}
        ${
          mode === 'all'
            ? sql`
          union all select 'album_artist', 'artist', artistId, role, displayOrder, 'outgoing'
            from music_album_artists where albumId = ${input.entityId}
          union all select 'label_album', 'label', label_id, null, null, 'incoming'
            from music_label_albums where album_id = ${input.entityId}`
            : sql``
        }`,
      ),
      Match.when(
        'track',
        () => sql`
        select 'track_artist' as relationship, 'artist' as entityType, artistId as entityId,
          role, displayOrder as position, 'outgoing' as direction from music_track_artists where trackId = ${input.entityId}
        union all select 'album_track', 'album', albumId, null, trackNumber, 'incoming'
          from music_tracks where id = ${input.entityId} and albumId is not null`,
      ),
      Match.when(
        'label',
        () => sql`
        select 'label_artist' as relationship, 'artist' as entityType, artist_id as entityId,
          null as role, null as position, 'outgoing' as direction from music_label_artists where label_id = ${input.entityId}
        union all select 'label_album', 'album', album_id, null, null, 'outgoing'
          from music_label_albums where label_id = ${input.entityId}`,
      ),
      Match.exhaustive,
    )

    const rows = yield* query(
      sql`select * from (${selected})
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
