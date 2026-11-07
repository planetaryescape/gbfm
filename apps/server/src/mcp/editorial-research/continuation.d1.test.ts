import { PostId } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import * as tables from '@/db/exports'
import { Database } from '@/db/layer'
import {
  musicAlbumsTable,
  musicPlaylistsTable,
  musicPlaylistTracksTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { oauthAccessToken, oauthResource } from '@/db/oauth.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuth, EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { withTestLayer } from '@/test/effect'

import { McpActor } from '../authorization'
import { CommandAuthority, makeOAuthCommandAuthority } from '../command-authority'
import { EditorialMcpConfig } from '../editorial'
import { loadEditorialSnapshot } from '../editorial-music/snapshot'
import { EditorialMcpSettings, projectPost } from '../model'
import {
  MusicRecommendationService,
  MusicRecommendationServiceLayer,
} from '../recommendations/service'
import {
  MusicRecommendationHandlersLayer,
  MusicRecommendationToolkit,
} from '../recommendations/toolkit'
import { composeMcpToolkits, makeMcpLayer } from '../server'
import { EditorialContextService, EditorialContextServiceLayer } from './context'
import { EditorialContextResult } from './contracts'
import { EditorialResearchServiceLayer } from './service'
import { EditorialResearchHandlersLayer, EditorialResearchToolkit } from './toolkit'

const harness = async () => {
  const fixture = await createEditorialOAuthFixture()
  const scopes = 'catalogue:read content:read posts:read offline_access'
  // Disposable resource policy only; production allowedScopes remains unchanged.
  await fixture.db
    .update(oauthResource)
    .set({ allowedScopes: JSON.stringify(scopes.split(' ')) })
    .where(eq(oauthResource.identifier, fixture.config.mcp.resourceUrl))
  const clientId = await fixture.register(scopes)

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(clientId, await fixture.authorize(clientId, 'owner', scopes))
    ).json(),
  )

  const principal = await Effect.runPromise(fixture.service.verify(tokens.access_token))
  const queries: Array<string> = []

  const observed = drizzle(fixture.database, {
    schema: tables,
    logger: { logQuery: (query) => queries.push(query) },
  })

  const oauth = await Effect.runPromise(
    withTestLayer(
      EditorialOAuth,
      EditorialOAuthLive.pipe(
        Layer.provide(Layer.succeed(Database, observed)),
        Layer.provide(Layer.succeed(ConfigService, fixture.config)),
      ),
    ),
  )

  const authority = await Effect.runPromise(
    makeOAuthCommandAuthority(tokens.access_token, principal).pipe(
      Effect.provideService(Database, observed),
      Effect.provideService(ConfigService, fixture.config),
      Effect.provideService(EditorialOAuth, oauth),
    ),
  )

  const config = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'test',
    resourceUrl: fixture.config.mcp.resourceUrl,
    frontendUrl: fixture.config.urls.frontend,
  })

  const base = Layer.mergeAll(
    Layer.succeed(Database, observed),
    Layer.succeed(EditorialMcpConfig, config),
  )

  const live = Layer.mergeAll(
    EditorialContextServiceLayer,
    EditorialResearchServiceLayer,
    MusicRecommendationServiceLayer,
  ).pipe(Layer.provide(base))

  const run = <A, E>(
    effect: Effect.Effect<A, E, EditorialContextService | MusicRecommendationService>,
    credentialAuthority = authority,
  ) =>
    Effect.runPromise(
      withTestLayer(effect, live).pipe(
        Effect.provideService(McpActor, principal),
        Effect.provideService(CommandAuthority, credentialAuthority),
      ),
    )

  const trackId = crypto.randomUUID()
  const secondId = crypto.randomUUID()
  const albumId = crypto.randomUUID()
  const postId = Schema.decodeUnknownSync(PostId)(crypto.randomUUID())
  const playlistId = crypto.randomUUID()
  const publishedAt = new Date(0)
  await fixture.db
    .insert(musicAlbumsTable)
    .values({ id: albumId, title: 'Recorded album', slug: albumId, publishedAt })
  await fixture.db.insert(musicTracksTable).values([
    { id: trackId, title: 'Second', slug: trackId, publishedAt, albumId, trackNumber: 2 },
    { id: secondId, title: 'First', slug: secondId, publishedAt, albumId, trackNumber: 1 },
  ])
  await fixture.db.insert(postsTable).values({
    id: postId,
    slug: postId,
    type: 'post',
    draft: true,
    content: 'PRIVATE SOURCE',
    musicEntityType: 'track',
    musicEntityId: trackId,
  })
  await fixture.db.insert(postCreators).values({ postId, creatorId: fixture.userId })
  await fixture.db
    .insert(musicPlaylistsTable)
    .values({ id: playlistId, slug: playlistId, title: 'Sequence', publishedAt })
  await fixture.db.insert(musicPlaylistTracksTable).values([
    { playlistId, trackId, position: 0 },
    { playlistId, trackId: secondId, position: 1 },
  ])

  return {
    fixture,
    clientId,
    config,
    base,
    live,
    run,
    principal,
    authority,
    queries,
    trackId,
    secondId,
    postId,
    playlistId,
    [Symbol.asyncDispose]: () => fixture[Symbol.asyncDispose](),
  }
}

test('persisted OAuth protects coherent draft versions and execution-time reads through official tools/call', async () => {
  await using h = await harness()

  const projected = await Effect.runPromise(
    projectPost(await Effect.runPromise(loadEditorialSnapshot(h.fixture.db, h.postId)), h.config),
  )

  const app = HttpRouter.toWebHandler(
    makeMcpLayer([], composeMcpToolkits(EditorialResearchToolkit, MusicRecommendationToolkit)).pipe(
      Layer.provide(EditorialResearchHandlersLayer),
      Layer.provide(MusicRecommendationHandlersLayer),
      Layer.provide(h.live),
      Layer.provide(h.base),
      Layer.provide(HttpServer.layerServices),
    ),
    {
      disableLogger: true,
      // Isolated protocol composition with a genuine persisted OAuth authority, not central discovery.
      middleware: (effect) =>
        effect.pipe(
          Effect.provideService(McpActor, h.principal),
          Effect.provideService(CommandAuthority, h.authority),
        ),
    },
  )

  try {
    h.queries.length = 0

    const response = await app.handler(
      new Request('https://api.example.test/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'get_draft_music_context',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'get_draft_music_context',
            arguments: { postId: h.postId, expectedVersion: projected.version },
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

    if (!payload) throw new Error('Missing protocol response')

    const envelope = Schema.decodeUnknownSync(
      Schema.Struct({
        result: Schema.Struct({
          structuredContent: EditorialContextResult,
          isError: Schema.optionalKey(Schema.Boolean),
        }),
      }),
    )(JSON.parse(payload))

    expect(envelope.result.structuredContent.post).toMatchObject({
      version: projected.version,
      source: 'PRIVATE SOURCE',
      draft: true,
    })
    expect(envelope.result.isError).not.toBe(true)
    expect(h.queries.length).toBeLessThanOrEqual(16)
    expect(h.queries.every((query) => !/\b(insert|update|delete|replace)\s/i.test(query))).toBe(
      true,
    )

    h.queries.length = 0

    const result = await h.run(
      Effect.flatMap(MusicRecommendationService, (service) =>
        service.suggestPlaylistSequence({
          playlistId: h.playlistId,
          expectedRevision: 0,
          strategy: 'album_blocks_v1',
        }),
      ),
    )

    expect(result.proposedTrackIds).toEqual([h.secondId, h.trackId])
    expect(h.queries.length).toBeLessThanOrEqual(16)
    h.queries.length = 0

    const connections = await h.run(
      Effect.flatMap(MusicRecommendationService, (service) =>
        service.suggestEditorialConnections({
          postId: h.postId,
          expectedVersion: projected.version,
        }),
      ),
    )

    expect(connections.candidates).toEqual([])
    expect(h.queries.length).toBeLessThanOrEqual(16)
    await h.fixture.db.delete(oauthAccessToken).where(eq(oauthAccessToken.clientId, h.clientId))

    const denied = await h.run(
      Effect.flatMap(EditorialContextService, (service) =>
        service.getDraftMusicContext({ postId: h.postId }),
      ).pipe(Effect.flip),
    )

    expect(denied.code).toBe('access_denied')
  } finally {
    await app.dispose()
  }
}, 15_000)

test('revocation after preflight blocks the completed sequence before disclosure', async () => {
  await using h = await harness()
  let revoked = false

  const authority = CommandAuthority.of({
    checkpoint: (scopes) =>
      h.authority.checkpoint(scopes).pipe(
        Effect.tap(() =>
          Effect.gen(function* () {
            if (!revoked) {
              revoked = true
              yield* Effect.promise(() =>
                h.fixture.db
                  .delete(oauthAccessToken)
                  .where(eq(oauthAccessToken.clientId, h.clientId)),
              )
            }
          }),
        ),
      ),
  })

  const denied = await h.run(
    Effect.flatMap(MusicRecommendationService, (service) =>
      service.suggestPlaylistSequence({
        playlistId: h.playlistId,
        expectedRevision: 0,
        strategy: 'album_blocks_v1',
      }),
    ).pipe(Effect.flip),
    authority,
  )

  expect(denied.code).toBe('access_denied')
  expect(
    (
      await h.fixture.db
        .select()
        .from(musicPlaylistTracksTable)
        .orderBy(musicPlaylistTracksTable.position)
    ).map((member) => member.trackId),
  ).toEqual([h.trackId, h.secondId])
}, 15_000)
