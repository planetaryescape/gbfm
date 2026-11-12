import { eq, sql } from 'drizzle-orm'
import { Deferred, Effect, Fiber, Layer, Redacted, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import {
  musicAlbumsTable,
  musicEntityLinksTable,
  musicEntityTypesTable,
  musicPlatformsTable,
  musicSourceAliasesTable,
  musicSourceIdentitiesTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { oauthAccessToken, oauthResource } from '@/db/oauth.schema'
import { makeOAuthCommandAuthority } from '@/mcp/command-authority'
import { McpArtworkStoreLayer } from '@/mcp/operations/staged-store'
import { createMcpOperationStore, McpOperationStore } from '@/mcp/operations/store'
import { MusicCoverImageFetcher } from '@/services/canonical-music-identity/artwork-delivery'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuth } from '@/services/editorial-oauth.service'
import {
  MusicLinkScraperService,
  MusicScraperError,
  type ScrapedLink,
} from '@/services/music-link-scraper.service'
import { S3Service } from '@/services/s3.service'
import { ObjectStoreClient } from '@/services/storage/object-store-client'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { withTestLayer } from '@/test/effect'
import { createTestWebHandler } from '@/test/http-handler'
import { makeTestS3Service } from '@/test/s3'

import { MusicImportArtwork, MusicImportArtworkLayer } from './artwork'
import type { ImportMusicUrlInput } from './commands'
import { MusicImportResult } from './service'

const scopes = 'posts:read catalogue:write catalogue:import providers:read offline_access'

const imported = Schema.decodeUnknownSync(
  Schema.Struct({
    result: Schema.Struct({ structuredContent: Schema.Struct({ import: MusicImportResult }) }),
  }),
)

const recordingLink = (
  matchedUrl: string,
  recordingId = '89d6a0f5-5c76-4307-a51f-4fadb97712d1',
): ScrapedLink => ({
  platform: 'musicbrainz',
  url: `https://musicbrainz.org/recording/${recordingId}`,
  scrapedAt: new Date(),
  metadata: {
    discoveredBy: 'musicbrainz',
    confidence: 'exact_url',
    mbidType: 'recording',
    mbid: recordingId,
    canonicalMbid: recordingId,
    matchedUrl,
  },
})

interface ControlledMetadataType {
  value: 'album' | 'artist' | 'song'
}

interface ControlledArtworkBody {
  mode: 'normal' | 'declared_oversize' | 'streamed_oversize' | 'stream_failure'
}

const setup = async () => {
  const fixture = await createEditorialOAuthFixture()
  await fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  await fixture.db.update(oauthResource).set({ allowedScopes: JSON.stringify(scopes.split(' ')) })
  const clientId = await fixture.register(scopes)

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(clientId, await fixture.authorize(clientId, 'owner', scopes))
    ).json(),
  )

  await fixture.db
    .insert(musicEntityTypesTable)
    .values([
      { id: 'album', displayName: 'Album' },
      { id: 'artist', displayName: 'Artist' },
      { id: 'track', displayName: 'Track' },
      { id: 'playlist', displayName: 'Playlist' },
    ])
    .onConflictDoNothing()
  await fixture.db
    .insert(musicPlatformsTable)
    .values([
      { id: 'spotify', displayName: 'Spotify' },
      { id: 'apple_music', displayName: 'Apple Music' },
      { id: 'soundcloud', displayName: 'SoundCloud' },
      { id: 'musicbrainz', displayName: 'MusicBrainz' },
      { id: 'other', displayName: 'Other' },
    ])
    .onConflictDoNothing()
  const links: Array<ScrapedLink> = []
  const metadataType: ControlledMetadataType = { value: 'album' }
  const artworkBody: ControlledArtworkBody = { mode: 'normal' }

  const state = {
    scrapes: 0,
    fetches: 0,
    puts: 0,
    rejectUpload: false,
    failAssociation: false,
    links,
    inferredPlaylist: false,
    fetchUnavailable: false,
    discardUpload: false,
    bytes: new Uint8Array([1, 2, 3]),
    revokeAtSql: false,
    expireAfterCommit: false,
    metadataType,
    artworkBody,
  }

  const objects = new Map<string, number>()
  const unexpected = () => Promise.reject(new Error('Unexpected object-store operation'))

  const storage = Layer.succeed(ObjectStoreClient, {
    provider: 'aws',
    putObject: async (input) => {
      state.puts++

      if (state.discardUpload) throw new Error('Upload failed before storing')
      objects.set(input.key, input.body instanceof Uint8Array ? input.body.byteLength : 3)

      if (state.failAssociation)
        await fixture.database
          .prepare(
            "CREATE TRIGGER reject_import_artwork BEFORE UPDATE ON music_albums WHEN NEW.coverImageUrl LIKE '%/imports/%' BEGIN SELECT RAISE(ABORT, 'controlled association failure'); END",
          )
          .run()

      if (state.rejectUpload) throw new Error('Lost upload acknowledgement')
    },
    headObject: async (_bucket, key) =>
      objects.has(key) ? { size: objects.get(key) ?? 0, metadata: {} } : null,
    presignPutObject: unexpected,
    deleteObject: unexpected,
    copyObject: unexpected,
    listObjects: unexpected,
    listBuckets: unexpected,
    createMultipartUpload: unexpected,
    presignUploadPart: unexpected,
    completeMultipartUpload: unexpected,
    abortMultipartUpload: unexpected,
    listMultipartParts: unexpected,
  })

  const scraper = Layer.succeed(MusicLinkScraperService, {
    scrape: () =>
      Effect.sync(() => {
        state.scrapes++

        return {
          links: state.links,
          entityMeta: {
            title: 'helmuth',
            type: state.inferredPlaylist ? ('playlist' as const) : state.metadataType.value,
            thumbnailUrl: 'https://i.scdn.co/image/disposable-import',
          },
        }
      }),
    discoverCrossPlatformLinks: () =>
      Effect.fail(
        new MusicScraperError({ provider: 'controlled', message: 'Unexpected discovery' }),
      ),
  })

  const operationStore = createMcpOperationStore(fixture.database)

  const guardedStore = Layer.succeed(McpOperationStore, {
    ...operationStore,
    execute: async (input) => {
      const result = await operationStore.execute({
        ...input,
        authorize: async (outcome) => {
          const authorized = await input.authorize(outcome)

          if (state.revokeAtSql && !outcome) {
            state.revokeAtSql = false
            await fixture.db.update(oauthAccessToken).set({ revoked: new Date() })
          }

          return authorized
        },
      })

      if (state.expireAfterCommit && result.status === 'applied') {
        state.expireAfterCommit = false
        await fixture.db
          .update(oauthAccessToken)
          .set({ expiresAt: new Date(0) })
          .where(eq(oauthAccessToken.clientId, clientId))
      }

      return result
    },
  })

  const createHandler = () =>
    createTestWebHandler(
      fixture.database,
      undefined,
      storage,
      Layer.succeed(MusicCoverImageFetcher, async (_url, init) => {
        state.fetches++
        expect(init?.redirect).toBe('manual')
        expect(init?.signal).toBeDefined()

        if (artworkBody.mode !== 'normal') {
          const maximum = 10 * 1024 * 1024
          const headers = new Headers({ 'content-type': 'image/jpeg' })

          if (artworkBody.mode === 'declared_oversize')
            headers.set('content-length', String(maximum + 1))

          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              if (artworkBody.mode === 'stream_failure') {
                controller.error(new Error('Controlled stream network failure'))

                return
              }

              controller.enqueue(new Uint8Array(maximum))
              controller.enqueue(new Uint8Array(1))
              controller.close()
            },
          })

          return new Response(body, { headers })
        }

        return new Response(state.bytes, {
          status: state.fetchUnavailable ? 503 : 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      }),
      Layer.succeed(ConfigService, {
        ...fixture.config,
        urls: { ...fixture.config.urls, bucketRouter: 'https://artwork.example.test' },
        auth: {
          ...fixture.config.auth,
          betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
        },
      }),
      undefined,
      undefined,
      { musicLinkScraper: scraper, operationStore: guardedStore },
    )

  let handler = createHandler()

  const send = (
    method: 'tools/list' | 'tools/call',
    params: Readonly<Record<string, Schema.Json>>,
    token = tokens.access_token,
    requestId: Schema.Json = 1,
  ) => {
    const headers = new Headers({
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      authorization: `Bearer ${Redacted.value(token)}`,
    })

    if (Schema.is(Schema.String)(params.name)) headers.set('mcp-name', params.name)

    return handler.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestId === null ? undefined : requestId,
          method,
          params: {
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    )
  }

  const rpc = async (
    method: 'tools/list' | 'tools/call',
    params: Readonly<Record<string, Schema.Json>>,
    token = tokens.access_token,
    expectedStatus = 200,
  ): Promise<Schema.Json> => {
    const response = await send(method, params, token)
    expect(response.status).toBe(expectedStatus)

    return response.status === 200
      ? Schema.decodeUnknownSync(Schema.Json)(await response.json())
      : null
  }

  const call = (
    input: typeof ImportMusicUrlInput.Type,
    name = 'import_music_url',
    token = tokens.access_token,
  ) => rpc('tools/call', { name, arguments: input }, token)

  return {
    fixture,
    state,
    tokens,
    clientId,
    objects,
    call,
    rpc,
    send,
    restart: async () => {
      await handler.dispose()
      handler = createHandler()
    },
    [Symbol.asyncDispose]: async () => {
      await handler.dispose()
      await fixture[Symbol.asyncDispose]()
    },
  }
}

test.each(['preserve', 'required'] as const)(
  'expiry after import commit refreshes and replays %s artwork without duplicate imports',
  async (artworkDelivery) => {
    await using f = await setup()
    f.state.expireAfterCommit = true

    const input = {
      requestId: crypto.randomUUID(),
      url: 'https://open.spotify.com/album/2T3Qwtj4INKHAAXD7WzFd8',
      expectedType: 'album' as const,
      artworkDelivery,
    }

    const response = await f.send('tools/call', { name: 'import_music_url', arguments: input })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"')
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('')

    const rows = await f.fixture.db.select().from(musicAlbumsTable)
    expect(rows).toHaveLength(1)
    expect(f.state.scrapes).toBe(1)
    expect(f.state.puts).toBe(0)

    const refreshed = await f.fixture.request('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: f.clientId,
      refresh_token: Redacted.value(f.tokens.refresh_token),
      resource: f.fixture.config.mcp.resourceUrl,
    })

    expect(refreshed.status).toBe(200)
    const tokens = Schema.decodeUnknownSync(OAuthTokens)(await refreshed.json())

    const result = imported(await f.call(input, 'import_music_url', tokens.access_token)).result
      .structuredContent.import

    expect(result).toMatchObject({
      receipt: 'replayed',
      completion: 'complete',
      catalogue: { disposition: 'created', entityId: rows[0]?.id },
    })
    expect(f.state.scrapes).toBe(1)
    expect(await f.fixture.db.select().from(musicAlbumsTable)).toHaveLength(1)
    expect(result.artwork.phase).toBe(artworkDelivery === 'required' ? 'delivered' : 'preserved')
    expect(f.state.fetches).toBe(artworkDelivery === 'required' ? 1 : 0)
    expect(f.state.puts).toBe(artworkDelivery === 'required' ? 1 : 0)
  },
  30000,
)

test('composed OAuth discovery, exact source import, original receipt replay, conflict and revoked replay', async () => {
  await using f = await setup()
  const readId = await f.fixture.register('posts:read offline_access')

  const readTokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await f.fixture.exchange(
        readId,
        await f.fixture.authorize(readId, 'owner', 'posts:read offline_access'),
      )
    ).json(),
  )

  const names = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
  )

  const adminTools = names(await f.rpc('tools/list', {})).result.tools.map((tool) => tool.name)
  expect(adminTools).toContain('import_music_url')

  const readTools = names(await f.rpc('tools/list', {}, readTokens.access_token)).result.tools.map(
    (tool) => tool.name,
  )

  expect(readTools).not.toContain('import_music_url')
  expect(readTools).not.toContain('get_music_import_status')
  expect(adminTools.filter((name) => !readTools.includes(name)).sort()).toEqual([
    'get_music_import_status',
    'import_music_url',
  ])

  const input = {
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/album/2T3Qwtj4INKHAAXD7WzFd8',
    expectedType: 'album' as const,
    artworkDelivery: 'preserve' as const,
  }

  const other = crypto.randomUUID()
  await f.fixture.db
    .insert(musicAlbumsTable)
    .values({ id: other, title: 'Sein Name ist helmuth', slug: `different-${other}` })
  await f.fixture.db.insert(musicEntityLinksTable).values({
    id: crypto.randomUUID(),
    entityType: 'album',
    entityId: other,
    platform: 'spotify',
    url: 'https://open.spotify.com/album/DifferentExactAlbum',
  })
  expect(await f.call(input, 'import_music_url', readTokens.access_token)).toMatchObject({
    result: { isError: true },
  })
  expect(f.state.scrapes).toBe(0)

  const invalid = await f.rpc('tools/call', {
    name: 'import_music_url',
    arguments: { ...input, requestId: crypto.randomUUID(), unexpected: 'must-not-be-ignored' },
  })

  expect(invalid).not.toHaveProperty('result.structuredContent')
  expect(f.state.scrapes).toBe(0)
  const first = imported(await f.call(input)).result.structuredContent.import
  expect(first).toMatchObject({
    receipt: 'applied',
    completion: 'complete',
    catalogue: {
      disposition: 'created',
      entityType: 'album',
      sourceKey: 'spotify:album:2T3Qwtj4INKHAAXD7WzFd8',
    },
    artwork: { phase: 'preserved' },
  })
  expect(first.catalogue.entityId).not.toBe(other)
  await f.restart()

  const replay = imported(await f.call({ ...input, url: `${input.url}?si=discarded` })).result
    .structuredContent.import

  expect(replay).toEqual({ ...first, receipt: 'replayed' })
  expect(f.state.scrapes).toBe(1)
  expect(await f.call({ ...input, artworkDelivery: 'required' })).toMatchObject({
    result: { isError: true, content: [{ text: expect.stringContaining('conflict') }] },
  })
  expect(f.state.scrapes).toBe(1)

  const status = imported(await f.call(input, 'get_music_import_status')).result.structuredContent
    .import

  expect(status.catalogue).toEqual(first.catalogue)
  await f.fixture.db.update(oauthAccessToken).set({ revoked: new Date() })

  const response = await f.rpc(
    'tools/call',
    { name: 'import_music_url', arguments: input },
    f.tokens.access_token,
    401,
  )

  expect(response).toBeNull()
}, 30000)

test('concurrent identical request keys and distinct keys converge without losing original created disposition', async () => {
  await using f = await setup()

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'preserve' as const,
  }

  const values = await Promise.all(
    Array.from(
      { length: 5 },
      async () => imported(await f.call(input)).result.structuredContent.import,
    ),
  )

  expect(new Set(values.map((value) => value.catalogue.entityId)).size).toBe(1)
  expect(values.every((value) => value.catalogue.disposition === 'created')).toBe(true)

  const reuse = imported(await f.call({ ...input, requestId: crypto.randomUUID() })).result
    .structuredContent.import

  expect(reuse.catalogue).toEqual({ ...values[0]?.catalogue, disposition: 'reused' })
  expect(await f.fixture.db.select().from(musicSourceIdentitiesTable)).toHaveLength(1)
}, 30000)

test('staged artwork survives upload success with lost acknowledgement and resumes immutable object without fetching again', async () => {
  await using f = await setup()
  f.state.rejectUpload = true

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  const first = imported(await f.call(input)).result.structuredContent.import
  expect(first).toMatchObject({
    catalogue: { disposition: 'created' },
    completion: 'pending_artwork',
    artwork: { phase: 'uploading' },
  })
  expect(f.objects.size).toBe(1)
  expect(f.state.fetches).toBe(1)
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${first.operationId}`,
  )
  f.state.rejectUpload = false
  await f.restart()
  const replay = imported(await f.call(input)).result.structuredContent.import
  expect(replay).toMatchObject({
    receipt: 'replayed',
    catalogue: first.catalogue,
    artwork: { phase: 'delivered', associatedRevision: first.catalogue.revision + 1 },
  })
  expect(f.state.fetches).toBe(1)
  expect(f.state.puts).toBe(1)
  expect(f.state.scrapes).toBe(1)
}, 30000)

test('upload success with failed database association remains association_pending and recovers after receipt expiry', async () => {
  await using f = await setup()
  f.state.failAssociation = true

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'best_effort' as const,
  }

  const first = imported(await f.call(input)).result.structuredContent.import
  expect(first.artwork.phase).toBe('association_pending')
  await f.fixture.database.prepare('DROP TRIGGER reject_import_artwork').run()
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${first.operationId}`,
  )
  const created = Date.now() - 86400001
  await f.fixture.db.run(
    sql`UPDATE mcp_operations SET created_at = ${created}, expires_at = ${created + 86400000} WHERE id = ${first.operationId}`,
  )
  const response = await f.call(input)
  expect(JSON.stringify(response)).not.toContain('"isError":true')
  const replay = imported(response).result.structuredContent.import
  expect(replay).toMatchObject({
    receipt: 'expired',
    catalogue: first.catalogue,
    artwork: { phase: 'delivered' },
  })
  expect(f.state.puts).toBe(1)
  expect(f.state.fetches).toBe(1)
}, 30000)

test('required fetch unavailability stays pending; frozen artifact mismatch fails without replaying a different upload', async () => {
  await using f = await setup()

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  f.state.fetchUnavailable = true
  const pending = imported(await f.call(input)).result.structuredContent.import
  expect(pending.artwork.phase).toBe('pending')
  expect(f.state.puts).toBe(0)
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${pending.operationId}`,
  )
  f.state.fetchUnavailable = false
  f.state.discardUpload = true
  const frozen = imported(await f.call(input)).result.structuredContent.import
  expect(frozen.artwork.phase).toBe('uploading')
  expect(f.state.puts).toBe(1)
  expect(f.objects.size).toBe(0)
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${pending.operationId}`,
  )
  f.state.discardUpload = false
  f.state.bytes = new Uint8Array([4, 5, 6])
  const mismatch = imported(await f.call(input)).result.structuredContent.import
  expect(mismatch).toMatchObject({
    catalogue: pending.catalogue,
    artwork: { phase: 'failed', failureCode: 'artifact_rejected' },
  })
  expect(f.state.puts).toBe(1)
}, 30000)

test('a later catalogue edit prevents artwork association without rebasing the original import revision', async () => {
  await using f = await setup()
  f.state.failAssociation = true

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  const first = imported(await f.call(input)).result.structuredContent.import
  await f.fixture.database.prepare('DROP TRIGGER reject_import_artwork').run()
  await f.fixture.db
    .update(musicAlbumsTable)
    .set({
      revision: first.catalogue.revision + 1,
      title: 'Later administrator edit',
      coverImageUrl: 'https://i.scdn.co/image/later-edit',
    })
    .where(eq(musicAlbumsTable.id, first.catalogue.entityId))
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${first.operationId}`,
  )
  const stale = imported(await f.call(input)).result.structuredContent.import
  expect(stale).toMatchObject({
    catalogue: first.catalogue,
    completion: 'partial',
    artwork: { phase: 'failed', failureCode: 'stale_revision' },
  })
  expect(
    (
      await f.fixture.db
        .select()
        .from(musicAlbumsTable)
        .where(eq(musicAlbumsTable.id, first.catalogue.entityId))
    )[0],
  ).toMatchObject({
    title: 'Later administrator edit',
    coverImageUrl: 'https://i.scdn.co/image/later-edit',
  })
}, 30000)

test('expired preserve receipts never create again, role downgrade denies replay, and inferred playlists cannot bypass admission', async () => {
  await using f = await setup()

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'preserve' as const,
  }

  const first = imported(await f.call(input)).result.structuredContent.import
  await f.fixture.db.update(user).set({ role: 'editor' }).where(eq(user.id, 'owner'))
  await f.rpc(
    'tools/call',
    { name: 'import_music_url', arguments: input },
    f.tokens.access_token,
    401,
  )
  await f.fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  const created = Date.now() - 86400001
  await f.fixture.db.run(
    sql`UPDATE mcp_operations SET created_at = ${created}, expires_at = ${created + 86400000} WHERE id = ${first.operationId}`,
  )
  expect(await f.call(input)).toMatchObject({
    result: { isError: true, content: [{ text: expect.stringContaining('expired') }] },
  })
  expect(f.state.scrapes).toBe(1)
  f.state.inferredPlaylist = true

  const denied = await f.call({
    requestId: crypto.randomUUID(),
    url: 'https://soundcloud.com/controlled/generic',
    artworkDelivery: 'preserve',
  })

  expect(denied).toMatchObject({
    result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
  })
  expect(await f.fixture.db.select().from(musicAlbumsTable)).toHaveLength(1)
}, 30000)

test('cross-provider discovery cannot substitute an incumbent with a different exact Spotify album', async () => {
  await using f = await setup()
  f.state.links.push({
    platform: 'apple_music',
    url: 'https://music.apple.com/us/album/disposable/123456',
    scrapedAt: new Date(),
  })

  const original = {
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/album/DifferentExistingRelease',
    expectedType: 'album' as const,
    artworkDelivery: 'preserve' as const,
  }

  const old = imported(await f.call(original)).result.structuredContent.import

  const candidate = {
    ...original,
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/album/2T3Qwtj4INKHAAXD7WzFd8',
  }

  expect(await f.call(candidate)).toMatchObject({
    result: { isError: true, content: [{ text: expect.stringContaining('conflict') }] },
  })
  expect(await f.fixture.db.select().from(musicAlbumsTable)).toHaveLength(1)
  expect(
    (
      await f.fixture.db
        .select()
        .from(musicEntityLinksTable)
        .where(eq(musicEntityLinksTable.entityId, old.catalogue.entityId))
    ).find((link) => link.platform === 'spotify')?.url,
  ).toBe(original.url)
}, 30000)

test('exact MusicBrainz recording evidence reuses alternate Spotify tracks without replacing listening links', async () => {
  await using f = await setup()
  f.state.metadataType.value = 'song'

  const original = {
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/track/OriginalRecording',
    expectedType: 'track' as const,
    artworkDelivery: 'preserve' as const,
  }

  f.state.links.push(recordingLink(original.url))
  const firstResponse = await f.call(original)
  expect(firstResponse).not.toHaveProperty('result.isError', true)
  const first = imported(firstResponse).result.structuredContent.import
  const before = await f.fixture.db.select().from(musicEntityLinksTable)

  const alternate = {
    ...original,
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/track/DeluxeRecording',
  }

  f.state.links.splice(0, f.state.links.length, recordingLink(alternate.url))

  const response = await f.call(alternate)
  expect(response).not.toHaveProperty('result.isError', true)
  const result = imported(response).result.structuredContent.import
  expect(result).toMatchObject({
    receipt: 'applied',
    completion: 'complete',
    catalogue: {
      disposition: 'reused',
      entityType: 'track',
      entityId: first.catalogue.entityId,
      revision: first.catalogue.revision + 1,
      sourceKey: 'spotify:track:DeluxeRecording',
      canonicalUrl: alternate.url,
    },
  })
  expect(await f.fixture.db.select().from(musicTracksTable)).toHaveLength(1)
  expect(await f.fixture.db.select().from(musicEntityLinksTable)).toEqual(before)
  const identities = await f.fixture.db.select().from(musicSourceIdentitiesTable)
  expect(identities.filter((identity) => identity.platform === 'spotify')).toEqual(
    expect.arrayContaining(
      ['OriginalRecording', 'DeluxeRecording'].map((id) =>
        expect.objectContaining({
          sourceKey: `spotify:track:${id}`,
          state: 'resolved',
          entityType: 'track',
          entityId: first.catalogue.entityId,
        }),
      ),
    ),
  )
  expect(
    await f.fixture.db
      .select()
      .from(musicSourceAliasesTable)
      .where(eq(musicSourceAliasesTable.normalizedUrl, alternate.url)),
  ).toMatchObject([{ sourceKey: 'spotify:track:DeluxeRecording' }])

  await f.restart()
  expect(imported(await f.call(alternate)).result.structuredContent.import).toEqual({
    ...result,
    receipt: 'replayed',
  })

  const reused = imported(await f.call({ ...alternate, requestId: crypto.randomUUID() })).result
    .structuredContent.import

  expect(reused.catalogue).toEqual(result.catalogue)
  expect(f.state.scrapes).toBe(2)
  expect(await f.fixture.db.select().from(musicEntityLinksTable)).toEqual(before)
}, 30000)

test.each([
  'missing incoming evidence',
  'non-exact incoming match',
  'ISRC-only incoming match',
  'different matched source',
  'non-recording MusicBrainz identity',
  'different recording',
  'missing original evidence',
  'rejected original recording link',
  'rejected original Spotify link',
])(
  'alternate Spotify tracks reject %s without changing the incumbent',
  async (scenario) => {
    await using f = await setup()
    f.state.metadataType.value = 'song'

    const original = {
      requestId: crypto.randomUUID(),
      url: 'https://open.spotify.com/track/OriginalRecording',
      expectedType: 'track' as const,
      artworkDelivery: 'preserve' as const,
    }

    const sharedLink: ScrapedLink = {
      platform: 'apple_music',
      url: 'https://music.apple.com/us/album/disposable/123456?i=654321',
      scrapedAt: new Date(),
    }

    f.state.links.push(sharedLink, recordingLink(original.url))
    const first = imported(await f.call(original)).result.structuredContent.import

    const alternate = {
      ...original,
      requestId: crypto.randomUUID(),
      url: 'https://open.spotify.com/track/DeluxeRecording',
    }

    let proposed = recordingLink(alternate.url)

    switch (scenario) {
      case 'missing incoming evidence':
        proposed.metadata = undefined
        break
      case 'non-exact incoming match':
        proposed.metadata = { ...proposed.metadata, confidence: 'search' }
        break
      case 'ISRC-only incoming match':
        proposed.metadata = { ...proposed.metadata, confidence: 'exact_isrc', matchedUrl: null }
        break
      case 'different matched source':
        proposed.metadata = { ...proposed.metadata, matchedUrl: original.url }
        break
      case 'non-recording MusicBrainz identity':
        proposed.metadata = { ...proposed.metadata, mbidType: 'release-group' }
        break
      case 'different recording':
        proposed = recordingLink(alternate.url, '1a24a7bc-4e39-49e0-ac13-21ea38290f0d')
        break
      case 'missing original evidence':
        await f.fixture.db
          .update(musicEntityLinksTable)
          .set({ metadata: null })
          .where(eq(musicEntityLinksTable.platform, 'musicbrainz'))
        break
      case 'rejected original recording link':
      case 'rejected original Spotify link':
        await f.fixture.db
          .update(musicEntityLinksTable)
          .set({ status: 'rejected' })
          .where(
            eq(
              musicEntityLinksTable.platform,
              scenario === 'rejected original Spotify link' ? 'spotify' : 'musicbrainz',
            ),
          )
        break
    }

    const before = await f.fixture.db.select().from(musicEntityLinksTable)
    const tracks = await f.fixture.db.select().from(musicTracksTable)
    const aliases = await f.fixture.db.select().from(musicSourceAliasesTable)
    f.state.links.splice(0, f.state.links.length, sharedLink, proposed)

    expect(await f.call(alternate)).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('conflict') }] },
    })
    expect(await f.fixture.db.select().from(musicEntityLinksTable)).toEqual(before)
    expect(await f.fixture.db.select().from(musicTracksTable)).toEqual(tracks)
    expect(await f.fixture.db.select().from(musicSourceAliasesTable)).toEqual(aliases)
    expect(
      await f.fixture.db
        .select()
        .from(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.sourceKey, 'spotify:track:DeluxeRecording')),
    ).toEqual([])
    expect(await f.fixture.db.get(sql`SELECT COUNT(*) AS count FROM mcp_operations`)).toEqual({
      count: 1,
    })
    expect((await f.fixture.db.select().from(musicTracksTable))[0]?.id).toBe(
      first.catalogue.entityId,
    )
  },
  30000,
)

test('persisted OAuth revocation after the final JS authorization is rejected by the atomic SQL guard', async () => {
  await using f = await setup()
  f.state.revokeAtSql = true

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  const denied = await f.send('tools/call', { name: 'import_music_url', arguments: input })
  expect(denied.status).toBe(401)
  expect(denied.headers.get('www-authenticate')).toContain('error="invalid_token"')
  expect(await denied.text()).toBe('')
  expect(await f.fixture.db.select().from(musicAlbumsTable)).toEqual([])
  expect(await f.fixture.db.get(sql`SELECT COUNT(*) AS count FROM mcp_operations`)).toEqual({
    count: 0,
  })
  expect(await f.fixture.db.get(sql`SELECT COUNT(*) AS count FROM mcp_operation_artwork`)).toEqual({
    count: 0,
  })
  expect(f.state.puts).toBe(0)
  await f.fixture.db.update(oauthAccessToken).set({ revoked: null })
  expect(imported(await f.call(input)).result.structuredContent.import.catalogue.disposition).toBe(
    'created',
  )
}, 30000)

test('legacy exact-source adoption preserves known-good verified link metadata instead of treating it as a new release', async () => {
  await using f = await setup()
  const id = crypto.randomUUID()
  const url = 'https://open.spotify.com/album/LegacyExactRelease'
  await f.fixture.db
    .insert(musicAlbumsTable)
    .values({ id, title: 'Known-good metadata', slug: `legacy-${id}` })

  const link = {
    id: crypto.randomUUID(),
    entityType: 'album' as const,
    entityId: id,
    platform: 'spotify' as const,
    url,
    metadata: { discoveredBy: 'manual', confidence: 'exact_source' },
  }

  await f.fixture.db.insert(musicEntityLinksTable).values(link)

  const before = await f.fixture.db
    .select()
    .from(musicEntityLinksTable)
    .where(eq(musicEntityLinksTable.id, link.id))

  const result = imported(
    await f.call({
      requestId: crypto.randomUUID(),
      url,
      expectedType: 'album',
      artworkDelivery: 'preserve',
    }),
  ).result.structuredContent.import

  expect(result.catalogue).toMatchObject({ disposition: 'reused', entityId: id })
  expect(f.state.scrapes).toBe(0)
  expect(
    await f.fixture.db
      .select()
      .from(musicEntityLinksTable)
      .where(eq(musicEntityLinksTable.id, link.id)),
  ).toEqual(before)
  expect(
    (await f.fixture.db.select().from(musicAlbumsTable).where(eq(musicAlbumsTable.id, id)))[0]
      ?.title,
  ).toBe('Known-good metadata')
}, 30000)

test('an actual upload timeout cancels waiting but retains the frozen recoverable stage', async () => {
  await using f = await setup()
  f.state.discardUpload = true

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  const first = imported(await f.call(input)).result.structuredContent.import
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${first.operationId}`,
  )
  const principal = await Effect.runPromise(f.fixture.service.verify(f.tokens.access_token))

  const authority = await Effect.runPromise(
    makeOAuthCommandAuthority(f.tokens.access_token, principal).pipe(
      Effect.provideService(Database, f.fixture.db),
      Effect.provideService(ConfigService, f.fixture.config),
      Effect.provideService(EditorialOAuth, f.fixture.service),
    ),
  )

  const started = await Effect.runPromise(Deferred.make<void>())
  let cancelled = false

  const storage = makeTestS3Service(() =>
    Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          cancelled = true
        }),
      ),
    ),
  )

  const layer = MusicImportArtworkLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Database, f.fixture.db),
        Layer.succeed(ConfigService, f.fixture.config),
        Layer.succeed(S3Service, storage),
        Layer.succeed(
          MusicCoverImageFetcher,
          async () =>
            new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }),
        ),
        McpArtworkStoreLayer(f.fixture.database),
      ),
    ),
  )

  const result = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.now())
        const artwork = yield* MusicImportArtwork

        const task = yield* artwork
          .run(
            {
              key: {
                actorId: principal.userId,
                clientId: principal.clientId,
                resource: f.fixture.config.mcp.resourceUrl,
                operation: 'import_music_url',
                requestId: input.requestId,
              },
              normalizedInput: {
                url: input.url,
                expectedType: input.expectedType,
                artworkDelivery: input.artworkDelivery,
              },
              sourceKey: first.catalogue.sourceKey,
              checkpoint: () =>
                authority.checkpoint(['catalogue:write', 'catalogue:import', 'providers:read']),
            },
            true,
          )
          .pipe(Effect.forkScoped)

        yield* Deferred.await(started)
        yield* TestClock.adjust('12 seconds')

        return yield* Fiber.join(task)
      }).pipe(Effect.scoped),
      Layer.mergeAll(layer, TestClock.layer()),
    ),
  )

  expect(result.phase).toBe('uploading')
  expect(cancelled).toBe(true)
  expect(f.objects.size).toBe(0)
  expect(
    imported(await f.call(input, 'get_music_import_status')).result.structuredContent.import
      .catalogue,
  ).toEqual(first.catalogue)
}, 30000)

test('artist and track imports deliver artwork with native entity references and separate association revisions', async () => {
  await using f = await setup()

  for (const type of ['artist', 'track'] as const) {
    f.state.metadataType.value = type === 'track' ? 'song' : 'artist'
    const id = crypto.randomUUID().replaceAll('-', '')

    const result = imported(
      await f.call({
        requestId: crypto.randomUUID(),
        url: `https://open.spotify.com/${type}/${id}`,
        expectedType: type,
        artworkDelivery: 'required',
      }),
    ).result.structuredContent.import

    expect(result).toMatchObject({
      catalogue: { disposition: 'created', entityType: type, sourceKey: `spotify:${type}:${id}` },
      artwork: { phase: 'delivered', associatedRevision: result.catalogue.revision + 1 },
    })

    const reused = imported(
      await f.call({
        requestId: crypto.randomUUID(),
        url: `https://open.spotify.com/${type}/${id}`,
        expectedType: type,
        artworkDelivery: 'required',
      }),
    ).result.structuredContent.import

    expect(reused).toMatchObject({
      catalogue: {
        disposition: 'reused',
        entityType: type,
        entityId: result.catalogue.entityId,
        revision: result.artwork.associatedRevision,
      },
      artwork: { phase: 'delivered' },
    })
  }
}, 30000)

test('id-less transport calls cannot import before a usable encoded response budget exists', async () => {
  await using f = await setup()

  const input = {
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/album/NoResponseBudget',
    expectedType: 'album',
    artworkDelivery: 'required',
  }

  const response = await f.send(
    'tools/call',
    { name: 'import_music_url', arguments: input },
    f.tokens.access_token,
    null,
  )

  await response.text()
  expect(f.state.scrapes).toBe(0)
  expect(f.state.puts).toBe(0)
  expect(await f.fixture.db.select().from(musicAlbumsTable)).toEqual([])
  expect(await f.fixture.db.get(sql`SELECT COUNT(*) AS count FROM mcp_operations`)).toEqual({
    count: 0,
  })
}, 30000)

test.each(['declared_oversize', 'streamed_oversize'] as const)(
  'oversized artwork is terminally rejected through the import service: %s',
  async (mode) => {
    await using f = await setup()
    f.state.artworkBody.mode = mode

    const input = {
      requestId: crypto.randomUUID(),
      url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
      expectedType: 'album' as const,
      artworkDelivery: 'required' as const,
    }

    const first = imported(await f.call(input)).result.structuredContent.import
    expect(first).toMatchObject({
      completion: 'partial',
      catalogue: { disposition: 'created' },
      artwork: { phase: 'failed', failureCode: 'artifact_rejected' },
    })
    expect(f.state.fetches).toBe(1)
    expect(f.state.puts).toBe(0)
    const replay = imported(await f.call(input)).result.structuredContent.import
    expect(replay).toEqual({ ...first, receipt: 'replayed' })
    expect(f.state.fetches).toBe(1)
    expect(f.state.puts).toBe(0)
  },
  30000,
)

test('a genuine artwork body-stream failure remains recoverable rather than becoming artifact rejection', async () => {
  await using f = await setup()
  f.state.artworkBody.mode = 'stream_failure'

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  const result = imported(await f.call(input)).result.structuredContent.import
  expect(result).toMatchObject({
    completion: 'pending_artwork',
    artwork: { phase: 'pending', failureCode: null },
  })
  expect(f.state.puts).toBe(0)
}, 30000)
