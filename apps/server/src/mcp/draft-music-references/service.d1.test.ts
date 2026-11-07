import { PostId } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { DraftMusicTarget } from '@gbfm/core/post-music-references'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { editorialOperations } from '@/db/editorial-operation.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { musicAlbumsTable, musicPlaylistsTable, musicTracksTable } from '@/db/music-entity.schema'
import { oauthAccessToken, oauthClient, oauthResource } from '@/db/oauth.schema'
import { postMusicReferencesTable } from '@/db/post-music-reference.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { makeMcpRoutes } from '@/http/editorial-mcp.routes'
import { AuthLive } from '@/lib/auth'
import { MdxServiceLayer } from '@/lib/mdx'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuth, EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { RecordingEmailTransportLayer } from '@/services/email-transport.service'
import { PostServiceLayer } from '@/services/post.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { withTestLayer } from '@/test/effect'

import { McpActor } from '../authorization'
import { CommandAuthority, makeOAuthCommandAuthority } from '../command-authority'
import { EditorialMcpConfig } from '../editorial'
import { DraftReferenceDisplay, ReferenceWriteResult } from '../editorial-music/contracts'
import { EditorialMusicService, EditorialMusicServiceLayer } from '../editorial-music/service'
import { loadEditorialSnapshot } from '../editorial-music/snapshot'
import { EditorialMcpSettings, projectPost } from '../model'
import { composeMcpToolkits, EditorialToolkit } from '../server'
import { makeMcpWireResponse, McpWireResponse } from '../wire-response'
import { DraftMusicReferencesService, DraftMusicReferencesServiceLayer } from './service'
import { DraftMusicReferencesToolkit, DraftMusicReferencesToolHandlersLayer } from './toolkit'

const ownerId = UserId.make('owner')

const harness = async () => {
  const resource = await createEditorialOAuthFixture()

  const config = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'local',
    resourceUrl: resource.config.mcp.resourceUrl,
    frontendUrl: resource.config.urls.frontend,
  })

  const db = resource.db
  const scope = 'posts:read drafts:write catalogue:read offline_access'
  const clientId = await resource.register(scope)
  // This disposable resource alone enables the approved expanded scope. Live policy is unchanged.
  await db.update(oauthResource).set({ allowedScopes: JSON.stringify(scope.split(' ')) })

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await resource.exchange(clientId, await resource.authorize(clientId, 'owner', scope))
    ).json(),
  )

  const principal = await Effect.runPromise(resource.service.verify(tokens.access_token))

  const authority = await Effect.runPromise(
    makeOAuthCommandAuthority(tokens.access_token, principal).pipe(
      Effect.provideService(Database, db),
      Effect.provideService(ConfigService, resource.config),
      Effect.provideService(EditorialOAuth, resource.service),
    ),
  )

  await db.update(user).set({ role: 'admin' }).where(eq(user.id, 'other'))
  const postId = PostId.make(crypto.randomUUID())
  await db.insert(postsTable).values({
    id: postId,
    slug: postId,
    title: 'Keep title',
    content: 'Keep body and embeds.  \n',
    description: 'Keep description',
    type: 'post',
    draft: true,
  })
  await db.insert(postCreators).values({ postId, creatorId: ownerId })

  const track = DraftMusicTarget.make({
    entityType: 'track',
    entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  })

  const playlist = DraftMusicTarget.make({
    entityType: 'playlist',
    entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })

  await db
    .insert(musicTracksTable)
    .values({ id: track.entityId, title: 'Track', slug: track.entityId })
  await db.insert(musicPlaylistsTable).values({
    id: playlist.entityId,
    title: 'Playlist',
    slug: playlist.entityId,
    publishedAt: new Date(0),
  })

  const layer = Layer.merge(DraftMusicReferencesServiceLayer, EditorialMusicServiceLayer).pipe(
    Layer.provide(Layer.succeed(Database, db)),
    Layer.provide(Layer.succeed(EditorialMcpConfig, config)),
  )

  const run = <A, E>(
    effect: Effect.Effect<A, E, DraftMusicReferencesService | EditorialMusicService>,
    actor = principal,
    trusted = true,
  ) => {
    const program = withTestLayer(effect, layer).pipe(
      Effect.provideService(McpActor, actor),
      Effect.provideService(McpWireResponse, makeMcpWireResponse(1, 'json')),
    )

    return Effect.runPromise(
      trusted ? program.pipe(Effect.provideService(CommandAuthority, authority)) : program,
    )
  }

  const snapshot = () => Effect.runPromise(loadEditorialSnapshot(db, postId))

  const mutation = async () => ({
    postId,
    requestId: crypto.randomUUID(),
    expectedVersion: (await Effect.runPromise(projectPost(await snapshot(), config))).version,
    musicReferences: { references: [track, playlist], primary: playlist },
  })

  const state = async () => ({
    posts: await db.select().from(postsTable),
    refs: await db.select().from(postMusicReferencesTable),
    receipts: await db.select().from(editorialOperations),
  })

  // Explicit test composition only: the production registry remains unchanged.
  const http = () => {
    const base = Layer.mergeAll(
      Layer.succeed(ConfigService, {
        ...resource.config,
        auth: {
          ...resource.config.auth,
          betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
        },
      }),
      MdxServiceLayer,
      UploadAssetServiceLayer,
      UnavailableObjectStoreClientLayer,
    ).pipe(Layer.provideMerge(DatabaseLayer(db.$client)))

    const email = EmailDeliveryLive.pipe(
      Layer.provide(RecordingEmailTransportLayer),
      Layer.provide(base),
    )

    const services = Layer.mergeAll(
      base,
      PostServiceLayer.pipe(Layer.provide(base)),
      EditorialOAuthLive.pipe(Layer.provide(base)),
      AuthLive.pipe(Layer.provide(email), Layer.provide(base)),
    )

    const app = HttpRouter.toWebHandler(
      makeMcpRoutes(
        composeMcpToolkits(EditorialToolkit, DraftMusicReferencesToolkit),
        DraftMusicReferencesToolHandlersLayer.pipe(Layer.provide(DraftMusicReferencesServiceLayer)),
      ).pipe(Layer.provide(services), Layer.provide(HttpServer.layerServices)),
      { disableLogger: true },
    )

    return {
      call: (args: Schema.Json, id: string | number = 1) =>
        app.handler(
          new Request(resource.config.mcp.resourceUrl, {
            method: 'POST',
            headers: {
              accept: 'application/json, text/event-stream',
              'content-type': 'application/json',
              'mcp-protocol-version': '2026-07-28',
              'mcp-method': 'tools/call',
              'mcp-name': 'set_draft_music_references',
              authorization: `Bearer ${Redacted.value(tokens.access_token)}`,
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id,
              method: 'tools/call',
              params: {
                name: 'set_draft_music_references',
                arguments: args,
                _meta: {
                  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                  'io.modelcontextprotocol/clientCapabilities': {},
                },
              },
            }),
          }),
        ),
      [Symbol.asyncDispose]: () => app.dispose(),
    }
  }

  return {
    db,
    http,
    principal,
    postId,
    track,
    playlist,
    run,
    snapshot,
    mutation,
    state,
    [Symbol.asyncDispose]: () => resource[Symbol.asyncDispose](),
  }
}

test('replacement persists ordered references and non-first primary, preserves source, and clears explicitly', async () => {
  await using h = await harness()
  const input = await h.mutation()

  const result = await h.run(
    Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input)),
  )

  expect(result.post.musicReferences).toMatchObject({
    ...input.musicReferences,
    display: [{ title: 'Track' }, { title: 'Playlist' }],
  })
  expect(result.post).toMatchObject({
    title: 'Keep title',
    content: 'Keep body and embeds.  \n',
    description: 'Keep description',
  })
  const saved = await h.snapshot()
  expect(saved).toMatchObject({
    musicReferences: input.musicReferences,
    musicReferencesManaged: true,
    musicEntityType: 'playlist',
    musicEntityId: h.playlist.entityId,
  })
  expect((await h.state()).refs).toMatchObject([
    { position: 0, trackId: h.track.entityId, isPrimary: false },
    { position: 1, playlistId: h.playlist.entityId, isPrimary: true },
  ])
  const clearInput = await h.mutation()

  const cleared = await h.run(
    Effect.flatMap(DraftMusicReferencesService, (s) =>
      s.setDraftMusicReferences({
        ...clearInput,
        musicReferences: { references: [], primary: null },
      }),
    ),
  )

  expect(cleared.post.musicReferences).toEqual({ references: [], primary: null, display: [] })
  expect((await h.snapshot()).musicReferencesManaged).toBe(true)
  expect((await h.state()).refs).toEqual([])
})

test('original-result replay preserves metadata/version and only removes now-private display', async () => {
  await using h = await harness()
  const input = await h.mutation()

  const call = () =>
    h.run(Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input)))

  const first = await call()
  await h.db
    .update(musicPlaylistsTable)
    .set({ title: 'Changed metadata' })
    .where(eq(musicPlaylistsTable.id, h.playlist.entityId))
  expect(await call()).toEqual(first)
  await h.db
    .update(musicPlaylistsTable)
    .set({ publishedAt: null })
    .where(eq(musicPlaylistsTable.id, h.playlist.entityId))
  const before = await h.state()
  const masked = await call()
  expect(masked).toEqual({
    ...first,
    post: {
      ...first.post,
      musicReferences: {
        ...first.post.musicReferences,
        display: [
          first.post.musicReferences.display[0],
          DraftReferenceDisplay.cases.Unavailable.make({ target: h.playlist }),
        ],
      },
    },
  })
  expect(await h.state()).toEqual(before)
})

test('replacement hash distinguishes order, primary, version and operation while normalizing UUID case', async () => {
  await using h = await harness()
  const input = await h.mutation()

  const first = await h.run(
    Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input)),
  )

  expect(
    await h.run(
      Effect.flatMap(DraftMusicReferencesService, (s) =>
        s.setDraftMusicReferences({
          ...input,
          musicReferences: {
            references: input.musicReferences.references.map((target) => ({
              ...target,
              entityId: target.entityId.toUpperCase(),
            })),
            primary: { ...h.playlist, entityId: h.playlist.entityId.toUpperCase() },
          },
        }),
      ),
    ),
  ).toEqual(first)
  const before = await h.state()

  for (const musicReferences of [
    { references: [h.playlist, h.track], primary: h.playlist },
    { references: [h.track, h.playlist], primary: h.track },
  ]) {
    await expect(
      h.run(
        Effect.flatMap(DraftMusicReferencesService, (s) =>
          s.setDraftMusicReferences({ ...input, musicReferences }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
  }

  await expect(
    h.run(
      Effect.flatMap(DraftMusicReferencesService, (s) =>
        s.setDraftMusicReferences({
          ...input,
          expectedVersion: first.post.version,
        }),
      ),
    ),
  ).rejects.toMatchObject({ code: 'conflict' })
  await expect(
    h.run(
      Effect.flatMap(EditorialMusicService, (s) =>
        s.setDraftTags({
          requestId: input.requestId,
          postId: h.postId,
          expectedVersion: first.post.version,
          tags: ['other-operation'],
        }),
      ),
    ),
  ).rejects.toMatchObject({ code: 'conflict' })
  expect(await h.state()).toEqual(before)
})

test('invalid replacements and hidden targets leave all state untouched', async () => {
  await using h = await harness()
  const input = await h.mutation()
  const before = await h.state()
  const tooMany = Array.from({ length: 51 }, () => ({ ...h.track, entityId: crypto.randomUUID() }))

  for (const musicReferences of [
    { references: [h.track, h.track], primary: null },
    { references: [h.track], primary: h.playlist },
    { references: tooMany, primary: null },
  ]) {
    await expect(
      h.run(
        Effect.flatMap(DraftMusicReferencesService, (s) =>
          s.setDraftMusicReferences({ ...input, musicReferences }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  }

  expect(await h.state()).toEqual(before)

  for (const publishedAt of [null, new Date(Date.now() + 86_400_000)]) {
    await h.db
      .update(musicPlaylistsTable)
      .set({ publishedAt })
      .where(eq(musicPlaylistsTable.id, h.playlist.entityId))
    const hiddenBefore = await h.state()
    await expect(
      h.run(Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input))),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(await h.state()).toEqual(hiddenBefore)
  }
})

test('stale/concurrent replacements cannot overwrite a committed collection', async () => {
  await using h = await harness()
  const input = await h.mutation()

  const results = await Promise.allSettled([
    h.run(Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input))),
    h.run(
      Effect.flatMap(DraftMusicReferencesService, (s) =>
        s.setDraftMusicReferences({
          ...input,
          requestId: crypto.randomUUID(),
          musicReferences: { references: [h.track], primary: null },
        }),
      ),
    ),
  ])

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
    { reason: { code: 'conflict' } },
  ])
  expect((await h.state()).receipts).toHaveLength(1)
})

test('all three scopes and current authored draft access apply to invocation and replay', async () => {
  await using h = await harness()
  const input = await h.mutation()
  await h.run(Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input)))
  const before = await h.state()

  for (const missing of ['posts:read', 'drafts:write', 'catalogue:read']) {
    await expect(
      h.run(
        Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input)),
        {
          ...h.principal,
          scopes: h.principal.scopes.filter((scope) => scope !== missing),
        },
      ),
    ).rejects.toMatchObject({ code: 'access_denied' })
  }

  await expect(
    h.run(
      Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input)),
      {
        ...h.principal,
        userId: UserId.make('other'),
      },
    ),
  ).rejects.toMatchObject({ code: 'access_denied' })
  expect(await h.state()).toEqual(before)
  await h.db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, h.postId))
  const published = await h.state()
  await expect(
    h.run(Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input))),
  ).rejects.toMatchObject({ code: 'not_found' })
  expect(await h.state()).toEqual(published)
})

test('case-equivalent submitted IDs persist canonical stored spelling, not caller spelling', async () => {
  await using h = await harness()
  const stored = { ...h.track, entityId: h.track.entityId.toUpperCase() }
  await h.db
    .update(musicTracksTable)
    .set({ id: stored.entityId })
    .where(eq(musicTracksTable.id, h.track.entityId))

  const input = {
    ...(await h.mutation()),
    musicReferences: { references: [h.track], primary: h.track },
  }

  const result = await h.run(
    Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input)),
  )

  expect(result.post.musicReferences).toMatchObject({ references: [stored], primary: stored })
  expect((await h.snapshot()).musicReferences).toEqual({ references: [stored], primary: stored })
})

test('receipt failure rolls the whole replacement back; expired replay never reapplies it', async () => {
  await using h = await harness()
  const input = await h.mutation()

  const call = () =>
    h.run(Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input)))

  const before = await h.state()
  await h.db.$client
    .prepare(
      `CREATE TRIGGER reject_reference_receipt BEFORE INSERT ON editorial_operations BEGIN SELECT RAISE(ABORT, 'fixture receipt rejection'); END`,
    )
    .run()
  await expect(call()).rejects.toMatchObject({ code: 'unavailable' })
  expect(await h.state()).toEqual(before)
  await h.db.$client.prepare('DROP TRIGGER reject_reference_receipt').run()
  await call()
  await h.db.update(editorialOperations).set({ createdAt: new Date(Date.now() - 86_400_001) })
  const expired = await h.state()
  await expect(call()).rejects.toMatchObject({ code: 'expired' })
  expect(await h.state()).toEqual(expired)
})

test('missing authority and revoked persisted OAuth grants deny writes and saved-result disclosure', async () => {
  await using h = await harness()
  const input = await h.mutation()

  const effect = Effect.flatMap(DraftMusicReferencesService, (s) =>
    s.setDraftMusicReferences(input),
  )

  const initial = await h.state()
  await expect(h.run(effect, h.principal, false)).rejects.toMatchObject({ code: 'access_denied' })
  expect(await h.state()).toEqual(initial)
  const saved = await h.run(effect)
  const before = await h.state()
  await h.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, h.principal.clientId))
  await expect(h.run(effect)).rejects.toMatchObject({ code: 'access_denied' })
  await h.db
    .update(oauthClient)
    .set({ disabled: false })
    .where(eq(oauthClient.clientId, h.principal.clientId))
  expect(await h.run(effect)).toEqual(saved)
  await h.db.update(oauthAccessToken).set({ revoked: new Date() })
  await expect(h.run(effect)).rejects.toMatchObject({ code: 'access_denied' })
  const fresh = { ...input, requestId: crypto.randomUUID(), expectedVersion: saved.post.version }
  await expect(
    h.run(Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(fresh))),
  ).rejects.toMatchObject({ code: 'access_denied' })
  expect(await h.state()).toEqual(before)
})

test('persisted OAuth revocation inside reference writes rolls back the post, references and receipt', async () => {
  await using h = await harness()
  const input = await h.mutation()
  const before = await h.state()
  await h.db.$client
    .prepare(
      `CREATE TRIGGER revoke_reference_grant AFTER INSERT ON post_music_references BEGIN UPDATE oauth_access_token SET revoked = 1; END`,
    )
    .run()
  await expect(
    h.run(Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input))),
  ).rejects.toMatchObject({ code: 'unavailable' })
  expect(await h.state()).toEqual(before)
  expect((await h.db.select().from(oauthAccessToken))[0]?.revoked).toBeNull()
})

test('real OAuth MCP wire preserves the reference codec, rejects missing precondition and denies revoked retries', async () => {
  await using h = await harness()
  await using app = h.http()
  const input = await h.mutation()
  const before = await h.state()

  const missing = await app.call({
    requestId: input.requestId,
    postId: input.postId,
    musicReferences: input.musicReferences,
  })

  expect(await missing.json()).toMatchObject({ result: { isError: true } })
  expect(await h.state()).toEqual(before)

  for (const invalid of [
    { ...input, unexpected: true },
    {
      ...input,
      musicReferences: {
        ...input.musicReferences,
        references: [{ ...h.track, url: 'https://example.test' }, h.playlist],
      },
    },
  ]) {
    expect(await (await app.call(invalid)).json()).toMatchObject({ result: { isError: true } })
    expect(await h.state()).toEqual(before)
  }

  const response = await app.call(input)
  expect(response.status).toBe(200)

  const result = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: ReferenceWriteResult }) }),
  )(await response.json()).result.structuredContent

  expect(result.post.musicReferences).toMatchObject(input.musicReferences)
  expect((await h.state()).receipts).toHaveLength(1)
  const receipt = (await h.state()).receipts[0]
  expect(receipt?.result).toContain('musicReferences')
  await h.db.update(oauthAccessToken).set({ revoked: new Date() })
  const revoked = await h.state()
  expect((await app.call(input)).status).toBe(401)
  expect(await h.state()).toEqual(revoked)
}, 15_000)

test('all 50 mixed public targets fit one atomic replacement; 51 rejects without writes', async () => {
  await using h = await harness()

  const targets = Array.from({ length: 50 }, (_, index) => ({
    entityType: ['album', 'track', 'playlist'][index % 3],
    entityId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
  })).map((target) => Schema.decodeUnknownSync(DraftMusicTarget)(target))

  for (const target of targets) {
    const row = {
      id: target.entityId,
      slug: target.entityId,
      title: `Full collection ${target.entityId}`,
      publishedAt: new Date(0),
    }

    if (target.entityType === 'album') await h.db.insert(musicAlbumsTable).values(row)
    else if (target.entityType === 'track') await h.db.insert(musicTracksTable).values(row)
    else await h.db.insert(musicPlaylistsTable).values(row)
  }

  const primary = targets[37]

  if (!primary) throw new Error('Missing full-collection primary fixture')
  const input = { ...(await h.mutation()), musicReferences: { references: targets, primary } }

  const result = await h.run(
    Effect.flatMap(DraftMusicReferencesService, (s) => s.setDraftMusicReferences(input)),
  )

  expect(result.post.musicReferences.references).toEqual(targets)
  expect(result.post.musicReferences.primary).toEqual(primary)
  expect((await h.state()).refs).toHaveLength(50)
  const before = await h.state()
  await expect(
    h.run(
      Effect.flatMap(DraftMusicReferencesService, (s) =>
        s.setDraftMusicReferences({
          ...input,
          requestId: crypto.randomUUID(),
          expectedVersion: result.post.version,
          musicReferences: { references: [...targets, h.track], primary },
        }),
      ),
    ),
  ).rejects.toMatchObject({ code: 'invalid_input' })
  expect(await h.state()).toEqual(before)
}, 15_000)

test('escaped MCP acknowledgements fit before commit or reject without writes, including identical retry', async () => {
  await using h = await harness()
  await using app = h.http()
  await h.db
    .update(postsTable)
    .set({ content: String.fromCharCode(92).repeat(20_000) })
    .where(eq(postsTable.id, h.postId))
  const control = await app.call(await h.mutation())
  expect(control.status).toBe(200)
  expect(await control.json()).toMatchObject({
    result: {
      structuredContent: { post: { musicReferences: { references: [h.track, h.playlist] } } },
    },
  })
  const longIdInput = await h.mutation()
  const beforeLongId = await h.state()

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.call(longIdInput, String.fromCharCode(92).repeat(100_000))
    expect((await h.state()).receipts).toHaveLength(beforeLongId.receipts.length)
    expect(await h.state()).toEqual(beforeLongId)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { isError: true } })
  }

  await h.db
    .update(postsTable)
    .set({ content: String.fromCharCode(92).repeat(60_000) })
    .where(eq(postsTable.id, h.postId))
  const input = await h.mutation()
  const before = await h.state()

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.call(input)
    expect((await h.state()).receipts).toHaveLength(before.receipts.length)
    expect(await h.state()).toEqual(before)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { isError: true } })
  }
}, 15_000)
