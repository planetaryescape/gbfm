import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import {
  musicAlbumArtistsTable,
  musicAlbumsTable,
  musicArtistsTable,
  musicLabelAlbumsTable,
  musicLabelsTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { McpActor, McpAuthorizationLive } from '../authorization'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { makeMcpLayer } from '../server'
import {
  MusicEditPreview,
  MusicEditPreviewHandlers,
  MusicEditPreviewLive,
  MusicEditPreviewToolkit,
  PreviewMetadataResult,
} from './preview'

const actorId = Schema.decodeUnknownSync(UserId)('m1-admin')

const actor = Schema.decodeUnknownSync(McpPrincipal)({
  userId: actorId,
  clientId: 'm1-client',
  scopes: ['catalogue:write'],
})

const services = MusicEditPreviewLive.pipe(
  Layer.provide(McpAuthorizationLive),
  Layer.provide(DatabaseTestLayer),
  Layer.provide(
    Layer.succeed(
      EditorialMcpConfig,
      Schema.decodeUnknownSync(EditorialMcpSettings)({
        readScope: 'posts:read',
        environment: 'test',
        resourceUrl: 'https://m1.example.test/mcp',
        frontendUrl: 'https://m1.example.test',
      }),
    ),
  ),
)

const preview = (input: Schema.Json, principal = actor) =>
  Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        return yield* (yield* MusicEditPreview).preview({ change: input })
      }).pipe(Effect.provideService(McpActor, principal)),
      services,
    ),
  )

beforeAll(async () => {
  await db.insert(user).values({
    id: actorId,
    name: 'Fixture admin',
    email: 'm1@example.test',
    role: 'admin',
  })
  await db.insert(musicAlbumsTable).values([
    { id: 'm1-album', slug: 'm1-album', title: 'Album', albumType: 'LP' },
    { id: 'm1-other-album', slug: 'm1-other-album', title: 'Other album' },
  ])
  await db.insert(musicTracksTable).values({
    id: 'm1-track',
    slug: 'm1-track',
    title: 'Track',
    albumId: 'm1-album',
  })
  await db.insert(musicArtistsTable).values([
    { id: 'm1-artist-z', slug: 'm1-artist-z', name: 'Zed', bio: 'Old bio' },
    { id: 'm1-artist-a', slug: 'm1-artist-a', name: 'Ada' },
  ])
  await db.insert(musicAlbumArtistsTable).values([
    { albumId: 'm1-album', artistId: 'm1-artist-z', role: 'primary', displayOrder: 3 },
    { albumId: 'm1-album', artistId: 'm1-artist-a', role: null, displayOrder: 3 },
  ])
  await db.insert(musicLabelsTable).values({
    id: 'm1-label',
    slug: 'm1-label',
    name: 'Label',
    description: 'Description',
  })
  await db.insert(musicLabelAlbumsTable).values({ labelId: 'm1-label', albumId: 'm1-album' })
  await db.insert(labelsTable).values([
    { id: 'm1-genre', kind: 'genre', name: 'Jazz' },
    { id: 'm1-tag', kind: 'tag', name: 'Private category' },
  ])
  await db.insert(entityLabelsTable).values([
    { entityId: 'm1-album', entityType: 'album', labelId: 'm1-genre', position: 0 },
    { entityId: 'm1-album', entityType: 'album', labelId: 'm1-tag', position: 1 },
  ])
})

test('preview observes a real browser-service edit, supports clearing, and never writes', async () => {
  const beforeAlbums = await db.select().from(musicAlbumsTable)
  const beforeTracks = await db.select().from(musicTracksTable)
  expect(
    await preview({ operation: 'set_album_type', entityId: 'm1-album', albumType: 'EP' }),
  ).toMatchObject({ before: 'LP', after: 'EP', changed: true, applyAvailable: false })
  expect(
    await preview({ operation: 'set_track_album', entityId: 'm1-track', albumId: null }),
  ).toMatchObject({ before: 'm1-album', after: null, changed: true })
  expect(
    await preview({ operation: 'set_track_album', entityId: 'm1-track', albumId: 'm1-album' }),
  ).toMatchObject({ changed: false })
  expect(await db.select().from(musicAlbumsTable)).toEqual(beforeAlbums)
  expect(await db.select().from(musicTracksTable)).toEqual(beforeTracks)

  const { updateAlbumEffect } = await import('@/services/music-entity/album.service')
  await Effect.runPromise(
    withTestLayer(updateAlbumEffect('m1-album', { albumType: 'single' }), DatabaseTestLayer),
  )
  expect(
    await preview({ operation: 'set_album_type', entityId: 'm1-album', albumType: null }),
  ).toMatchObject({ before: 'single', after: null, changed: true })
})

test('all metadata and relationship proposals use bounded exact pairs without changing persisted state', async () => {
  const state = async () => ({
    artists: await db.select().from(musicArtistsTable),
    albums: await db.select().from(musicAlbumsTable),
    tracks: await db.select().from(musicTracksTable),
    labels: await db.select().from(musicLabelsTable),
    credits: await db.select().from(musicAlbumArtistsTable),
    affiliations: await db.select().from(musicLabelAlbumsTable),
    genres: await db.select().from(entityLabelsTable),
  })

  const before = await state()
  expect(
    await preview({
      operation: 'update_music_metadata',
      entityType: 'artist',
      entityId: 'm1-artist-z',
      metadata: { bio: null },
    }),
  ).toMatchObject({ before: { bio: 'Old bio' }, after: { bio: null }, changed: true })
  expect(
    await preview({
      operation: 'update_music_metadata',
      entityType: 'album',
      entityId: 'm1-album',
      metadata: { title: 'Album', releaseDate: '2001-02-03T00:00:00.000Z' },
    }),
  ).toMatchObject({
    before: { title: 'Album', releaseDate: null },
    after: { title: 'Album', releaseDate: '2001-02-03T00:00:00.000Z' },
  })
  expect(
    await preview({
      operation: 'update_music_metadata',
      entityType: 'track',
      entityId: 'm1-track',
      metadata: { title: 'Track' },
    }),
  ).toMatchObject({ changed: false })
  expect(
    await preview({
      operation: 'update_music_metadata',
      entityType: 'label',
      entityId: 'm1-label',
      metadata: { description: null },
    }),
  ).toMatchObject({ before: { description: 'Description' }, after: { description: null } })
  expect(
    await preview({
      operation: 'set_music_genres',
      entityType: 'album',
      entityId: 'm1-album',
      genres: [],
    }),
  ).toMatchObject({ before: ['Jazz'], after: [] })

  const credit = {
    operation: 'set_artist_credit',
    entityType: 'album',
    entityId: 'm1-album',
    artistId: 'm1-artist-z',
    role: 'featured',
    displayOrder: 0,
  }

  const result = await preview(credit)
  expect(result.before).toEqual([
    { artistId: 'm1-artist-a', name: 'Ada', role: null, displayOrder: 3 },
    { artistId: 'm1-artist-z', name: 'Zed', role: 'primary', displayOrder: 3 },
  ])
  expect(result.after).toEqual([
    { artistId: 'm1-artist-z', name: 'Zed', role: 'featured', displayOrder: 0 },
    { artistId: 'm1-artist-a', name: 'Ada', role: null, displayOrder: 3 },
  ])
  expect(
    await preview({
      operation: 'remove_artist_credit',
      entityType: 'album',
      entityId: 'm1-album',
      artistId: 'm1-artist-z',
    }),
  ).toMatchObject({
    after: [{ artistId: 'm1-artist-a', name: 'Ada', role: null, displayOrder: 3 }],
  })
  expect(
    await preview({
      operation: 'set_label_affiliation',
      entityType: 'album',
      entityId: 'm1-album',
      labelId: 'm1-label',
    }),
  ).toMatchObject({ before: ['m1-label'], after: ['m1-label'], changed: false })
  expect(
    await preview({
      operation: 'remove_label_affiliation',
      entityType: 'album',
      entityId: 'm1-album',
      labelId: 'm1-label',
    }),
  ).toMatchObject({ after: [] })
  expect(await state()).toEqual(before)

  for (const change of [
    { ...credit, artistId: 'missing' },
    {
      operation: 'set_label_affiliation',
      entityType: 'artist',
      entityId: 'm1-artist-z',
      labelId: 'missing',
    },
  ])
    await expect(preview(change)).rejects.toMatchObject({ code: 'not_found' })
})

test('metadata allowlists reject hidden authority, unsupported fields and ambiguous clearing', async () => {
  for (const metadata of [
    {},
    { publishedAt: null },
    { name: null },
    { name: 'Zed', slug: 'hijack' },
    { artistNames: ['Spoof'] },
    { bio: 'x', createdById: 'other' },
  ]) {
    await expect(
      preview({
        operation: 'update_music_metadata',
        entityType: 'artist',
        entityId: 'm1-artist-z',
        metadata,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  }

  for (const genres of [
    ['Jazz', 'Jazz'],
    [' Jazz'],
    Array.from({ length: 31 }, (_, i) => `Genre${i}`),
  ]) {
    await expect(
      preview({ operation: 'set_music_genres', entityType: 'album', entityId: 'm1-album', genres }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  }
})

test('missing targets/references, unsupported fields and unauthorized accounts deny', async () => {
  await expect(
    preview({ operation: 'set_track_album', entityId: 'm1-track', albumId: 'missing' }),
  ).rejects.toMatchObject({ code: 'not_found' })
  await expect(
    preview({ operation: 'set_album_type', entityId: 'missing', albumType: 'LP' }),
  ).rejects.toMatchObject({ code: 'not_found' })
  await expect(
    preview({ operation: 'set_track_album', entityId: 'missing', albumId: null }),
  ).rejects.toMatchObject({ code: 'not_found' })

  for (const input of [
    { operation: 'set_album_type', entityId: 'm1-album', albumType: 'bogus' },
    { operation: 'set_album_type', entityId: 'm1-album' },
    { operation: 'set_album_type', entityId: 'm1-album', albumType: 'LP', publishedAt: 'now' },
    { operation: 'set_artist_credit', entityId: 'm1-track', artistId: 'artist' },
  ])
    await expect(preview(input)).rejects.toMatchObject({ code: 'invalid_input' })

  await expect(preview({}, { ...actor, scopes: ['catalogue:read'] })).rejects.toMatchObject({
    code: 'access_denied',
  })

  try {
    await db.update(user).set({ role: 'creator' }).where(eq(user.id, actorId))
    await expect(preview({})).rejects.toMatchObject({ code: 'access_denied' })
    await db.update(user).set({ role: 'admin', banned: true }).where(eq(user.id, actorId))
    await expect(preview({})).rejects.toMatchObject({ code: 'access_denied' })
  } finally {
    await db.update(user).set({ role: 'admin', banned: false }).where(eq(user.id, actorId))
  }
})

const app = HttpRouter.toWebHandler(
  makeMcpLayer([], MusicEditPreviewToolkit).pipe(
    Layer.provide(MusicEditPreviewHandlers),
    Layer.provide(services),
    Layer.provide(HttpServer.layerServices),
  ),
  {
    disableLogger: true,
    middleware: (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest

        const principal =
          request.headers['x-fixture-scope'] === 'read'
            ? { ...actor, scopes: ['catalogue:read'] as const }
            : actor

        return yield* effect.pipe(Effect.provideService(McpActor, principal))
      }),
  },
)

afterAll(() => app.dispose())

const callPreview = (change: Schema.Json, scope: 'read' | 'write' = 'write') =>
  app.handler(
    new Request('https://m1.example.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'preview_metadata_changes',
        'x-fixture-scope': scope,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'preview_metadata_changes',
          arguments: { change },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  )

test('real MCP 2026-07-28 tools/call returns the bounded read-only result', async () => {
  const response = await callPreview({
    operation: 'set_track_album',
    entityId: 'm1-track',
    albumId: 'm1-other-album',
  })

  expect(response.status).toBe(200)

  const envelope = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ structuredContent: PreviewMetadataResult }),
    }),
  )(await response.json())

  expect(envelope.result.structuredContent).toMatchObject({
    status: 'preview_only',
    before: 'm1-album',
    after: 'm1-other-album',
    applyAvailable: false,
  })
  expect(
    (await db.select().from(musicTracksTable).where(eq(musicTracksTable.id, 'm1-track')))[0]
      ?.albumId,
  ).toBe('m1-album')
})

test('real MCP accepts the full relationship proposal and returns the same ordered plan', async () => {
  const change = {
    operation: 'set_artist_credit',
    entityType: 'album',
    entityId: 'm1-album',
    artistId: 'm1-artist-z',
    role: null,
    displayOrder: 1,
  }

  const response = await callPreview(change)

  const envelope = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: PreviewMetadataResult }) }),
  )(await response.json())

  expect(envelope.result.structuredContent).toEqual(await preview(change))
  expect(envelope.result.structuredContent.after).toEqual([
    { artistId: 'm1-artist-z', name: 'Zed', role: null, displayOrder: 1 },
    { artistId: 'm1-artist-a', name: 'Ada', role: null, displayOrder: 3 },
  ])
})

test('protocol validates before service authorization and uses framework errors for malformed parameters', async () => {
  const response = await callPreview(
    {
      operation: 'set_album_type',
      entityId: 'm1-album',
      albumType: 'LP',
      publishedAt: 'now',
    },
    'read',
  )

  const envelope = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        isError: Schema.Boolean,
        content: Schema.Array(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })),
      }),
    }),
  )(await response.json())

  expect(envelope.result.isError).toBe(true)
  expect(envelope.result.content[0]?.text).toContain('Invalid parameters')
  expect(envelope.result.content[0]?.text).toContain('publishedAt')

  const valid = await callPreview(
    {
      operation: 'set_album_type',
      entityId: 'm1-album',
      albumType: 'LP',
    },
    'read',
  )

  const denied = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        isError: Schema.Boolean,
        content: Schema.Array(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })),
      }),
    }),
  )(await valid.json())

  expect(denied.result.isError).toBe(true)
  expect(denied.result.content[0]?.text).toContain('access_denied')
})
