import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import * as tables from '@/db/exports'
import { Database } from '@/db/layer'
import {
  musicAlbumArtistsTable,
  musicAlbumsTable,
  musicArtistsTable,
  musicLabelAlbumsTable,
  musicLabelArtistsTable,
  musicLabelsTable,
  musicPlaylistsTable,
  musicPlaylistTracksTable,
  musicTracksTable,
  musicTrackArtistsTable,
} from '@/db/music-entity.schema'
import { postMusicReferencesTable } from '@/db/post-music-reference.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'
import { db, d1 } from '@/test/database'

import { McpActor } from '../authorization'
import { CommandAuthority } from '../command-authority'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { ConnectionsResult, SequenceResult, SimilarResult } from '../recommendations/contracts'
import {
  MusicRecommendationService,
  MusicRecommendationServiceLayer,
} from '../recommendations/service'
import {
  MusicRecommendationHandlersLayer,
  MusicRecommendationToolkit,
} from '../recommendations/toolkit'
import { composeMcpToolkits, makeMcpLayer } from '../server'
import { domainReadAuthority } from './authority.test-support'
import { EditorialContextResult, ResearchResult } from './contracts'
import { EditorialResearchService, EditorialResearchServiceLayer } from './service'
import { EditorialResearchHandlersLayer, EditorialResearchToolkit } from './toolkit'

const past = new Date('2020-01-01T00:00:00Z')

const future = new Date('2099-01-01T00:00:00Z')

const queries: Array<{ query: string; params: Array<unknown> }> = []

const database = Layer.succeed(
  Database,
  drizzle(d1, {
    schema: tables,
    logger: { logQuery: (query, params) => queries.push({ query, params }) },
  }),
)

const settings = Schema.decodeUnknownSync(EditorialMcpSettings)({
  readScope: 'posts:read',
  environment: 'test',
  resourceUrl: 'https://api.example.test/mcp',
  frontendUrl: 'https://example.test',
})

const live = Layer.mergeAll(EditorialResearchServiceLayer, MusicRecommendationServiceLayer).pipe(
  Layer.provide(database),
  Layer.provide(Layer.succeed(EditorialMcpConfig, settings)),
)

const principal = (scopes: ReadonlyArray<string>) =>
  Schema.decodeUnknownSync(McpPrincipal)({
    userId: 'evidence-user',
    clientId: 'evidence-client',
    scopes,
  })

const run = <A, E>(
  effect: Effect.Effect<A, E, EditorialResearchService | MusicRecommendationService>,
  scopes = ['catalogue:read', 'content:read'],
) =>
  Effect.runPromise(
    effect.pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Test entry point; runPromise owns this complete layer lifetime.
      Effect.provide(live),
      Effect.provideService(McpActor, principal(scopes)),
      Effect.provideService(CommandAuthority, domainReadAuthority(principal(scopes))),
    ),
  )

const app = HttpRouter.toWebHandler(
  makeMcpLayer([], composeMcpToolkits(EditorialResearchToolkit, MusicRecommendationToolkit)).pipe(
    Layer.provide(EditorialResearchHandlersLayer),
    Layer.provide(MusicRecommendationHandlersLayer),
    Layer.provide(live),
    Layer.provide(database),
    Layer.provide(Layer.succeed(EditorialMcpConfig, settings)),
    Layer.provide(HttpServer.layerServices),
  ),
  {
    disableLogger: true,
    middleware: (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest

        const actor = principal(
          request.headers['x-test-scopes']?.split(' ') ?? ['catalogue:read', 'content:read'],
        )

        return yield* effect.pipe(
          Effect.provideService(McpActor, actor),
          Effect.provideService(CommandAuthority, domainReadAuthority(actor)),
        )
      }),
  },
)

const Envelope = Schema.Struct({
  result: Schema.optionalKey(
    Schema.Struct({
      isError: Schema.optionalKey(Schema.Boolean),
      structuredContent: Schema.optionalKey(Schema.Unknown),
    }),
  ),
  error: Schema.optionalKey(Schema.Unknown),
})

const call = async (name: string, args: Schema.Json, scopes = 'catalogue:read content:read') => {
  const response = await app.handler(
    new Request('https://api.example.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name,
        'x-test-scopes': scopes,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  )

  expect(response.status).toBe(200)
  const text = await response.text()

  const payload =
    text.startsWith('event:') || text.startsWith('data:')
      ? text
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
      : text

  if (!payload) throw new Error('Missing tool response')

  return Schema.decodeUnknownSync(Envelope)(JSON.parse(payload))
}

afterAll(() => app.dispose())

beforeAll(async () => {
  await db
    .insert(user)
    .values({ id: 'evidence-user', name: 'Reader', email: 'reader@evidence.test', role: 'editor' })
  await db.insert(musicArtistsTable).values([
    { id: 'a', name: 'Recorded A', slug: 'a', publishedAt: past },
    { id: 'b', name: 'Recorded B', slug: 'b', publishedAt: past },
    { id: 'secret-artist', name: 'SECRET ARTIST', slug: 'secret-artist', publishedAt: null },
  ])
  await db
    .insert(musicLabelsTable)
    .values({ id: 'l', name: 'Label', slug: 'l', publishedAt: past, content: 'PRIVATE BODY' })
  await db.insert(musicAlbumsTable).values([
    { id: 'album', title: 'Album', slug: 'album', publishedAt: past },
    { id: 'other', title: 'Other', slug: 'other', publishedAt: past },
  ])
  await db.insert(musicTracksTable).values([
    {
      id: 'seed',
      title: 'Seed',
      slug: 'seed',
      albumId: 'album',
      publishedAt: past,
      trackNumber: 2,
    },
    {
      id: 'z-same',
      title: 'Same album',
      slug: 'z-same',
      albumId: 'album',
      publishedAt: past,
      trackNumber: 1,
    },
    { id: 'a-artist', title: 'Same artist', slug: 'a-artist', albumId: 'other', publishedAt: past },
    { id: 'b-genre', title: 'Same genre', slug: 'b-genre', publishedAt: past },
    {
      id: 'null-track',
      title: 'SECRET NULL',
      slug: 'null-track',
      albumId: 'album',
      publishedAt: null,
    },
    {
      id: 'future-track',
      title: 'SECRET FUTURE',
      slug: 'future-track',
      albumId: 'album',
      publishedAt: future,
    },
  ])
  await db.insert(musicAlbumArtistsTable).values([
    { albumId: 'album', artistId: 'a' },
    { albumId: 'album', artistId: 'b', role: 'featured' },
  ])
  await db.insert(musicTrackArtistsTable).values([
    { trackId: 'seed', artistId: 'a' },
    { trackId: 'a-artist', artistId: 'a' },
  ])
  await db.insert(musicLabelArtistsTable).values({ labelId: 'l', artistId: 'a' })
  await db.insert(musicLabelAlbumsTable).values({ labelId: 'l', albumId: 'album' })
  await db.insert(labelsTable).values({ id: 'g', kind: 'genre', name: 'Recorded genre' })
  await db.insert(entityLabelsTable).values([
    { entityType: 'track', entityId: 'seed', labelId: 'g', position: 0 },
    { entityType: 'track', entityId: 'b-genre', labelId: 'g', position: 0 },
    { entityType: 'track', entityId: 'null-track', labelId: 'g', position: 0 },
    { entityType: 'musicLabel', entityId: 'l', labelId: 'g', position: 0 },
  ])
  await db.insert(postsTable).values([
    {
      id: 'public',
      title: 'Public reference',
      slug: 'public',
      type: 'post',
      draft: false,
      musicEntityType: 'track',
      musicEntityId: 'seed',
    },
    {
      id: 'private',
      title: 'SECRET DRAFT',
      slug: 'private',
      type: 'post',
      draft: true,
      musicEntityType: 'track',
      musicEntityId: 'seed',
    },
    {
      id: 'managed',
      title: 'Managed reference',
      slug: 'managed',
      type: 'post',
      draft: false,
      musicReferencesManaged: true,
    },
    {
      id: 'hidden-target',
      title: 'SECRET TARGET POST',
      slug: 'hidden-target',
      type: 'post',
      draft: false,
      musicEntityType: 'track',
      musicEntityId: 'null-track',
    },
  ])
  await db
    .insert(postMusicReferencesTable)
    .values({ postId: 'managed', position: 0, trackId: 'seed', isPrimary: true })
})

test('public research uses recorded edges, publication and structured references without private bodies', async () => {
  const results = await run(
    Effect.gen(function* () {
      const reads = yield* EditorialResearchService

      return {
        genre: yield* reads.exploreGenre({ genreId: 'g' }),
        label: yield* reads.exploreLabel({ labelId: 'l' }),
        collaborations: yield* reads.findArtistCollaborations({ artistId: 'a' }),
        coverage: yield* reads.getMusicCoverage({ entityType: 'track', entityId: 'seed' }),
        undercovered: yield* reads.findUndercoveredMusic({
          entities: [
            { entityType: 'track', entityId: 'seed' },
            { entityType: 'track', entityId: 'b-genre' },
          ],
        }),
        sources: yield* reads.getMusicResearchSources({ entityType: 'track', entityId: 'seed' }),
      }
    }),
  )

  expect(results.genre.entities.map((entity) => entity.entityId)).toEqual(['l', 'b-genre', 'seed'])
  expect(results.label.entities.map((entity) => entity.entityId)).toEqual(['l', 'album', 'a'])
  expect(
    results.collaborations.relations.map((relation) => [
      relation.object.entityId,
      relation.witnessId,
      relation.role,
    ]),
  ).toEqual([['b', 'album', 'featured']])
  expect(results.coverage.editorials.map((post) => post.postId)).toEqual(['managed', 'public'])
  expect(
    results.undercovered.coverage.map((entry) => [entry.music.entityId, entry.sampledMatches]),
  ).toEqual([
    ['b-genre', 0],
    ['seed', 2],
  ])
  expect(results.sources.sources).toEqual([])
  expect(
    results.coverage.citations.every((citation) =>
      /^sha256:[0-9a-f]{64}$/.test(citation.sourceFingerprint),
    ),
  ).toBe(true)
  expect(JSON.stringify(results)).not.toMatch(/SECRET|PRIVATE BODY|createdBy|verifiedBy/)
})

test('similarity ranks album ahead of artist ahead of genre and has stable canonical digest', async () => {
  const call = () =>
    run(
      Effect.gen(function* () {
        const recommendations = yield* MusicRecommendationService

        return yield* recommendations.findSimilarMusic({
          seed: { entityType: 'track', entityId: 'seed' },
        })
      }),
      ['catalogue:read'],
    )

  const first = await call()
  const second = await call()
  expect(first.candidates.map((candidate) => [candidate.music.entityId, candidate.tier])).toEqual([
    ['z-same', 1],
    ['a-artist', 2],
    ['b-genre', 4],
  ])
  expect(first.basisDigest).toBe(second.basisDigest)
  expect(first.evidence.map((evidence) => evidence.kind)).toEqual([
    'same_album',
    'shared_artist',
    'shared_genre',
  ])
  expect(JSON.stringify(first)).not.toMatch(/SECRET|null-track|future-track|confidence|affinity/)
  const before = await d1.prepare('select count(*) n from music_tracks').first('n')
  await call()
  expect(await d1.prepare('select count(*) n from music_tracks').first('n')).toBe(before)
})

test('live scopes deny public research even with draft scope, and deny nonpublished seeds', async () => {
  const denied = await run(
    Effect.gen(function* () {
      const reads = yield* EditorialResearchService

      return yield* reads
        .getMusicCoverage({ entityType: 'track', entityId: 'seed' })
        .pipe(Effect.flip)
    }),
    ['catalogue:read', 'posts:read'],
  )

  expect(denied.code).toBe('access_denied')

  const hidden = await run(
    Effect.gen(function* () {
      const recommendations = yield* MusicRecommendationService

      return yield* recommendations
        .findSimilarMusic({ seed: { entityType: 'track', entityId: 'null-track' } })
        .pipe(Effect.flip)
    }),
    ['catalogue:read'],
  )

  expect(hidden.code).toBe('not_found')
})

test('hidden rows cannot consume a recommendation window; actual reads obey statement and write bounds', async () => {
  await db
    .insert(musicArtistsTable)
    .values({ id: 'cap-artist', name: 'Cap artist', slug: 'cap-artist', publishedAt: past })

  const tracks = [
    { id: 'cap-seed', title: 'Cap seed', slug: 'cap-seed', publishedAt: past },
    { id: 'zz-visible', title: 'Visible', slug: 'zz-visible', publishedAt: past },
    ...Array.from({ length: 205 }, (_, index) => ({
      id: `000-hidden-${index}`,
      title: 'SECRET',
      slug: `000-hidden-${index}`,
      publishedAt: future,
    })),
  ]

  for (let index = 0; index < tracks.length; index += 5) {
    const chunk = tracks.slice(index, index + 5)
    await db.batch([
      db.insert(musicTracksTable).values(chunk),
      db
        .insert(musicTrackArtistsTable)
        .values(chunk.map((track) => ({ trackId: track.id, artistId: 'cap-artist' }))),
    ])
  }

  queries.length = 0

  const result = await run(
    Effect.gen(function* () {
      const recommendations = yield* MusicRecommendationService

      return yield* recommendations.findSimilarMusic({
        seed: { entityType: 'track', entityId: 'cap-seed' },
      })
    }),
    ['catalogue:read'],
  )

  expect(result.candidates.map((candidate) => candidate.music.entityId)).toEqual(['zz-visible'])
  expect(result.candidateWindow).toEqual({ examined: 1, cap: 200, truncated: false })
  expect(queries.length).toBeLessThanOrEqual(16)
  expect(queries.every(({ query }) => !/\b(insert|update|delete|replace)\s/i.test(query))).toBe(
    true,
  )
})

test('versioned MCP exposes parsed evidence and similarity; grants and excess inputs fail closed', async () => {
  const research = await call('get_music_coverage', { entityType: 'track', entityId: 'seed' })
  expect(research.result?.isError).not.toBe(true)
  const coverage = Schema.decodeUnknownSync(ResearchResult)(research.result?.structuredContent)
  expect(coverage.editorials.map((post) => post.postId)).toEqual(['managed', 'public'])

  const recommendation = await call(
    'find_similar_music',
    { seed: { entityType: 'track', entityId: 'seed' } },
    'catalogue:read',
  )

  const similar = Schema.decodeUnknownSync(SimilarResult)(recommendation.result?.structuredContent)
  expect(similar.candidates[0]?.music.entityId).toBe('z-same')

  const denied = await call(
    'get_music_coverage',
    { entityType: 'track', entityId: 'seed' },
    'catalogue:read posts:read',
  )

  expect(denied.result?.isError).toBe(true)

  const invalid = await call('find_similar_music', {
    seed: { entityType: 'track', entityId: 'seed' },
    provider: 'not-approved',
  })

  expect(invalid.error !== undefined || invalid.result?.isError === true).toBe(true)
})

test('coherent explicit draft context preserves references and version, but never another owner or micro', async () => {
  const trackId = crypto.randomUUID()
  await db
    .insert(musicTracksTable)
    .values({ id: trackId, title: 'Context track', slug: trackId, publishedAt: past })
  await db.insert(postsTable).values({
    id: 'context-public',
    slug: 'context-public',
    draft: false,
    type: 'post',
    musicEntityType: 'track',
    musicEntityId: trackId,
  })
  await db.insert(postCreators).values({ postId: 'private', creatorId: 'evidence-user' })
  await db
    .update(postsTable)
    .set({ content: 'Untrusted source '.repeat(1000), musicEntityId: trackId })
    .where(eq(postsTable.id, 'private'))

  const response = await call(
    'get_draft_music_context',
    { postId: 'private' },
    'posts:read catalogue:read',
  )

  const context = Schema.decodeUnknownSync(EditorialContextResult)(
    response.result?.structuredContent,
  )

  expect(context.post).toMatchObject({ postId: 'private', draft: true, sourceTruncated: true })
  expect(context.post.source.length).toBe(8000)
  expect(context.references).toEqual([
    {
      entityType: 'track',
      entityId: trackId,
      primary: true,
      availability: 'eligible',
      name: 'Context track',
    },
  ])
  expect(JSON.stringify(context)).not.toContain('creatorIds')

  const stale = await call(
    'get_draft_music_context',
    { postId: 'private', expectedVersion: `sha256:${'0'.repeat(64)}` },
    'posts:read catalogue:read',
  )

  expect(stale.result?.isError).toBe(true)
  const publicContext = await call('get_editorial_context', { postId: 'context-public' })
  expect(
    Schema.decodeUnknownSync(EditorialContextResult)(publicContext.result?.structuredContent).post
      .draft,
  ).toBe(false)
  const draftWithoutGrant = await call('get_editorial_context', { postId: 'private' })
  expect(draftWithoutGrant.result?.isError).toBe(true)
  await db.delete(postCreators).where(eq(postCreators.postId, 'private'))

  const other = await call(
    'get_draft_music_context',
    { postId: 'private' },
    'posts:read catalogue:read',
  )

  expect(other.result?.isError).toBe(true)
  await db
    .insert(postsTable)
    .values({ id: 'context-micro', slug: 'context-micro', draft: true, type: 'micro' })
  await db.insert(postCreators).values({ postId: 'context-micro', creatorId: 'evidence-user' })
  expect(
    (
      await call(
        'get_draft_music_context',
        { postId: 'context-micro' },
        'posts:read catalogue:read',
      )
    ).result?.isError,
  ).toBe(true)
})

test('editorial connections use primary same-kind evidence, explicit unsupported seeds and public-only windows', async () => {
  const hiddenTrackId = crypto.randomUUID()
  await db
    .insert(musicTracksTable)
    .values({ id: hiddenTrackId, title: 'Hidden reference', slug: hiddenTrackId })
  await db.insert(postsTable).values([
    {
      id: 'album-coverage',
      slug: 'album-coverage',
      type: 'post',
      draft: false,
      musicEntityType: 'album',
      musicEntityId: 'album',
    },
    {
      id: 'related-coverage',
      slug: 'related-coverage',
      type: 'post',
      draft: false,
      musicEntityType: 'track',
      musicEntityId: 'z-same',
    },
    {
      id: 'ineligible-reference',
      slug: 'ineligible-reference',
      type: 'post',
      draft: false,
      musicEntityType: 'track',
      musicEntityId: hiddenTrackId,
    },
  ])

  const artist = await call('suggest_editorial_connections', {
    music: { entityType: 'artist', entityId: 'a' },
  })

  expect(
    Schema.decodeUnknownSync(ConnectionsResult)(artist.result?.structuredContent),
  ).toMatchObject({
    status: 'insufficient_evidence',
    candidates: [],
    limits: [{ code: 'unsupported_seed_relation' }],
  })

  const album = await call('suggest_editorial_connections', {
    music: { entityType: 'album', entityId: 'album' },
  })

  expect(
    Schema.decodeUnknownSync(ConnectionsResult)(album.result?.structuredContent).candidates.map(
      (post) => post.postId,
    ),
  ).toContain('album-coverage')

  const track = await call('suggest_editorial_connections', {
    music: { entityType: 'track', entityId: 'seed' },
  })

  const connected = Schema.decodeUnknownSync(ConnectionsResult)(track.result?.structuredContent)
  expect(connected.candidates.map((post) => post.postId)).toEqual([
    'managed',
    'public',
    'related-coverage',
  ])
  expect(connected.candidates[0]?.url).toBe('https://example.test/editorial/managed')
  expect(connected.evidence.every((item) => item.sourceFingerprint.startsWith('sha256:'))).toBe(
    true,
  )

  const again = await call('suggest_editorial_connections', {
    music: { entityType: 'track', entityId: 'seed' },
  })

  expect(
    Schema.decodeUnknownSync(ConnectionsResult)(again.result?.structuredContent).basisDigest,
  ).toBe(connected.basisDigest)

  const unavailable = await call('suggest_editorial_connections', {
    postId: 'ineligible-reference',
  })

  expect(
    Schema.decodeUnknownSync(ConnectionsResult)(unavailable.result?.structuredContent),
  ).toMatchObject({
    status: 'insufficient_evidence',
    candidates: [],
    inputs: { music: null },
    limits: [{ code: 'missing_eligible_reference' }],
  })

  const invalid = await call('suggest_editorial_connections', {
    postId: 'public',
    music: { entityType: 'track', entityId: 'seed' },
  })

  expect(invalid.error !== undefined || invalid.result?.isError === true).toBe(true)
  const playlistId = crypto.randomUUID()
  await db
    .insert(musicPlaylistsTable)
    .values({ id: playlistId, title: 'Unsupported seed', slug: playlistId, publishedAt: past })
  await db.insert(postsTable).values([
    { id: 'no-reference', slug: 'no-reference', type: 'post', draft: false },
    {
      id: 'playlist-reference',
      slug: 'playlist-reference',
      type: 'post',
      draft: false,
      musicEntityType: 'playlist',
      musicEntityId: playlistId,
    },
  ])
  const absent = await call('suggest_editorial_connections', { postId: 'no-reference' })
  expect(
    Schema.decodeUnknownSync(ConnectionsResult)(absent.result?.structuredContent),
  ).toMatchObject({
    status: 'insufficient_evidence',
    candidates: [],
    limits: [{ code: 'missing_structured_reference' }],
  })
  const unsupported = await call('suggest_editorial_connections', { postId: 'playlist-reference' })
  expect(
    Schema.decodeUnknownSync(ConnectionsResult)(unsupported.result?.structuredContent),
  ).toMatchObject({
    status: 'insufficient_evidence',
    candidates: [],
    limits: [{ code: 'unsupported_seed_relation' }],
  })
  const playlistContext = await call('get_editorial_context', { postId: 'playlist-reference' })
  expect(
    Schema.decodeUnknownSync(EditorialContextResult)(playlistContext.result?.structuredContent)
      .references,
  ).toEqual([
    {
      entityType: 'playlist',
      entityId: playlistId,
      primary: true,
      availability: 'eligible',
      name: 'Unsupported seed',
    },
  ])
  await db
    .update(musicPlaylistsTable)
    .set({ publishedAt: future })
    .where(eq(musicPlaylistsTable.id, playlistId))

  const hiddenPlaylistContext = await call('get_editorial_context', {
    postId: 'playlist-reference',
  })

  expect(
    Schema.decodeUnknownSync(EditorialContextResult)(
      hiddenPlaylistContext.result?.structuredContent,
    ).references[0],
  ).toMatchObject({ availability: 'unavailable', name: null })
})

test('complete sequence uses PL1 snapshot, hides ineligible albums and rejects stale or hidden tracks without writes', async () => {
  await db
    .insert(musicPlaylistsTable)
    .values({ id: 'sequence', title: 'Sequence', slug: 'sequence', publishedAt: past })
  await db.insert(musicPlaylistTracksTable).values([
    { playlistId: 'sequence', trackId: 'seed', position: 0 },
    { playlistId: 'sequence', trackId: 'a-artist', position: 1 },
    { playlistId: 'sequence', trackId: 'z-same', position: 2 },
    { playlistId: 'sequence', trackId: 'b-genre', position: 3 },
  ])
  const input = { playlistId: 'sequence', expectedRevision: 0, strategy: 'album_blocks_v1' }

  const before = await db
    .select()
    .from(musicPlaylistTracksTable)
    .where(eq(musicPlaylistTracksTable.playlistId, 'sequence'))

  queries.length = 0
  const response = await call('suggest_playlist_sequence', input, 'catalogue:read')
  const result = Schema.decodeUnknownSync(SequenceResult)(response.result?.structuredContent)
  expect(result).toMatchObject({
    status: 'sufficient',
    changed: true,
    originalTrackIds: ['seed', 'a-artist', 'z-same', 'b-genre'],
    proposedTrackIds: ['z-same', 'seed', 'a-artist', 'b-genre'],
  })
  expect(result.positions.map((member) => member.position)).toEqual([0, 1, 2, 3])
  expect(queries.length).toBeLessThanOrEqual(16)
  expect(queries.every(({ query }) => !/\b(insert|update|delete|replace)\s/i.test(query))).toBe(
    true,
  )
  expect(
    await db
      .select()
      .from(musicPlaylistTracksTable)
      .where(eq(musicPlaylistTracksTable.playlistId, 'sequence')),
  ).toEqual(before)
  const repeated = await call('suggest_playlist_sequence', input, 'catalogue:read')
  expect(
    Schema.decodeUnknownSync(SequenceResult)(repeated.result?.structuredContent).basisDigest,
  ).toBe(result.basisDigest)
  await db
    .update(musicPlaylistTracksTable)
    .set({ position: 0 })
    .where(eq(musicPlaylistTracksTable.playlistId, 'sequence'))
  const tied = await call('suggest_playlist_sequence', input, 'catalogue:read')
  expect(
    Schema.decodeUnknownSync(SequenceResult)(tied.result?.structuredContent).limits.map(
      (limit) => limit.code,
    ),
  ).toContain('tied_positions')

  for (const member of before)
    await db
      .update(musicPlaylistTracksTable)
      .set({ position: member.position })
      .where(eq(musicPlaylistTracksTable.trackId, member.trackId))

  const stale = await call(
    'suggest_playlist_sequence',
    { ...input, expectedRevision: 1 },
    'catalogue:read',
  )

  expect(stale.result?.isError).toBe(true)
  await db
    .update(musicAlbumsTable)
    .set({ publishedAt: future })
    .where(eq(musicAlbumsTable.id, 'album'))
  const hiddenAlbum = await call('suggest_playlist_sequence', input, 'catalogue:read')
  const singleton = Schema.decodeUnknownSync(SequenceResult)(hiddenAlbum.result?.structuredContent)
  expect(singleton).toMatchObject({
    status: 'insufficient_evidence',
    changed: false,
    evidence: [],
    proposedTrackIds: result.originalTrackIds,
  })
  expect(JSON.stringify(singleton)).not.toContain('"albumId":"album"')
  await db
    .update(musicAlbumsTable)
    .set({ publishedAt: past })
    .where(eq(musicAlbumsTable.id, 'album'))
  await db
    .update(musicTracksTable)
    .set({ publishedAt: null })
    .where(eq(musicTracksTable.id, 'seed'))
  expect((await call('suggest_playlist_sequence', input, 'catalogue:read')).result?.isError).toBe(
    true,
  )
  await d1
    .prepare('UPDATE music_tracks SET publishedAt = ? WHERE id = ?')
    .bind(-9_000_000_000_000_000, 'seed')
    .run()
  expect((await call('suggest_playlist_sequence', input, 'catalogue:read')).result?.isError).toBe(
    true,
  )
  await db
    .update(musicTracksTable)
    .set({ publishedAt: past })
    .where(eq(musicTracksTable.id, 'seed'))
  await db
    .update(musicPlaylistsTable)
    .set({ publishedAt: null })
    .where(eq(musicPlaylistsTable.id, 'sequence'))
  expect((await call('suggest_playlist_sequence', input, 'catalogue:read')).result?.isError).toBe(
    true,
  )
})

test('sequence accepts the complete 100-member boundary but not a 101-member prefix', async () => {
  await db.insert(musicPlaylistsTable).values({
    id: 'boundary-sequence',
    title: 'Boundary',
    slug: 'boundary-sequence',
    publishedAt: past,
  })

  const input = {
    playlistId: 'boundary-sequence',
    expectedRevision: 0,
    strategy: 'album_blocks_v1',
  }

  const empty = await call('suggest_playlist_sequence', input, 'catalogue:read')
  expect(Schema.decodeUnknownSync(SequenceResult)(empty.result?.structuredContent)).toMatchObject({
    status: 'insufficient_evidence',
    originalTrackIds: [],
    proposedTrackIds: [],
  })

  const tracks = Array.from({ length: 101 }, (_, i) => ({
    id: `boundary-${i}`,
    title: 'Boundary member',
    slug: `boundary-${i}`,
    publishedAt: past,
  }))

  for (let i = 0; i < tracks.length; i += 5)
    await db.insert(musicTracksTable).values(tracks.slice(i, i + 5))

  const memberships = tracks.map((track, position) => ({
    playlistId: 'boundary-sequence',
    trackId: track.id,
    position,
  }))

  for (let i = 0; i < 100; i += 10)
    await db.insert(musicPlaylistTracksTable).values(memberships.slice(i, i + 10))
  const complete = await call('suggest_playlist_sequence', input, 'catalogue:read')
  const result = Schema.decodeUnknownSync(SequenceResult)(complete.result?.structuredContent)
  expect(result.proposedTrackIds).toEqual(tracks.slice(0, 100).map((track) => track.id))
  expect(result.changed).toBe(false)
  const last = memberships[100]

  if (!last) throw new Error('Missing boundary fixture')
  await db.insert(musicPlaylistTracksTable).values(last)
  const oversized = await call('suggest_playlist_sequence', input, 'catalogue:read')
  expect(oversized.result?.isError).toBe(true)
})
