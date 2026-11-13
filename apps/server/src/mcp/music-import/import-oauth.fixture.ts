import { eq } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { expect } from 'vitest'

import { user } from '@/db/auth.schema'
import { musicEntityTypesTable, musicPlatformsTable } from '@/db/music-entity.schema'
import { oauthAccessToken, oauthResource } from '@/db/oauth.schema'
import { createMcpOperationStore, McpOperationStore } from '@/mcp/operations/store'
import { MusicCoverImageFetcher } from '@/services/canonical-music-identity/artwork-delivery'
import { ConfigService } from '@/services/config.service'
import {
  MusicLinkScraperService,
  MusicScraperError,
  type ScrapedLink,
} from '@/services/music-link-scraper.service'
import { ObjectStoreClient } from '@/services/storage/object-store-client'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { createTestWebHandler } from '@/test/http-handler'

import type { ImportMusicUrlInput } from './commands'
import { MusicImportResult } from './service'

const scopes = 'posts:read catalogue:write catalogue:import providers:read offline_access'

export const imported = Schema.decodeUnknownSync(
  Schema.Struct({
    result: Schema.Struct({ structuredContent: Schema.Struct({ import: MusicImportResult }) }),
  }),
)

interface ControlledMetadataType {
  value: 'album' | 'artist' | 'song'
}

interface ControlledArtworkBody {
  mode: 'normal' | 'declared_oversize' | 'streamed_oversize' | 'stream_failure'
}

export const setup = async () => {
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
