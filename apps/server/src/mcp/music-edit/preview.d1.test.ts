import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { musicAlbumsTable, musicTracksTable } from '@/db/music-entity.schema'
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

test('missing targets/references, unsupported fields and unauthorized accounts deny', async () => {
  await expect(
    preview({ operation: 'set_track_album', entityId: 'm1-track', albumId: 'missing' }),
  ).rejects.toMatchObject({ code: 'not_found' })
  await expect(
    preview({ operation: 'set_album_type', entityId: 'missing', albumType: 'LP' }),
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
  await db.update(user).set({ role: 'creator' }).where(eq(user.id, actorId))
  await expect(preview({})).rejects.toMatchObject({ code: 'access_denied' })
  await db.update(user).set({ role: 'admin', banned: true }).where(eq(user.id, actorId))
  await expect(preview({})).rejects.toMatchObject({ code: 'access_denied' })
  await db.update(user).set({ banned: false }).where(eq(user.id, actorId))
})

const app = HttpRouter.toWebHandler(
  makeMcpLayer([], MusicEditPreviewToolkit).pipe(
    Layer.provide(MusicEditPreviewHandlers),
    Layer.provide(services),
    Layer.provide(HttpServer.layerServices),
  ),
  {
    disableLogger: true,
    middleware: (effect) => effect.pipe(Effect.provideService(McpActor, actor)),
  },
)

afterAll(() => app.dispose())

test('real MCP 2026-07-28 tools/call returns the bounded read-only result', async () => {
  const response = await app.handler(
    new Request('https://m1.example.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'preview_metadata_changes',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'preview_metadata_changes',
          arguments: {
            change: {
              operation: 'set_track_album',
              entityId: 'm1-track',
              albumId: 'm1-other-album',
            },
          },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  )

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
  expect((await db.select().from(musicTracksTable))[0]?.albumId).toBe('m1-album')
})
