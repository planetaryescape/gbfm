import { PostId } from '@gbfm/core/editorial-mcp'
import { DraftMusicTarget } from '@gbfm/core/post-music-references'
import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { editorialOperations } from '@/db/editorial-operation.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { musicAlbumsTable, musicPlaylistsTable, musicTracksTable } from '@/db/music-entity.schema'
import { oauthAccessToken, oauthClient } from '@/db/oauth.schema'
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
import { GetPostResult } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings, projectPost } from '../model'
import { composeMcpToolkits, EditorialToolkit } from '../server'
import { makeMcpWireResponse, McpWireResponse } from '../wire-response'
import { saveEditorialChange } from './save'
import { EditorialMusicService, EditorialMusicServiceLayer } from './service'
import { loadEditorialSnapshot } from './snapshot'
import { draftMusicTargetsGuard } from './targets'
import { EditorialMusicToolkit, EditorialMusicToolHandlersLayer } from './toolkit'

const harness = async () => {
  const fixture = await createEditorialOAuthFixture()
  const clientId = await fixture.register('posts:read drafts:write offline_access')

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(
        clientId,
        await fixture.authorize(clientId, 'owner', 'posts:read drafts:write offline_access'),
      )
    ).json(),
  )

  const principal = await Effect.runPromise(fixture.service.verify(tokens.access_token))

  const authority = await Effect.runPromise(
    makeOAuthCommandAuthority(tokens.access_token, principal).pipe(
      Effect.provideService(Database, fixture.db),
      Effect.provideService(ConfigService, fixture.config),
      Effect.provideService(EditorialOAuth, fixture.service),
    ),
  )

  const settings = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'test',
    resourceUrl: fixture.config.mcp.resourceUrl,
    frontendUrl: fixture.config.urls.frontend,
  })

  const service = EditorialMusicServiceLayer.pipe(
    Layer.provide(Layer.succeed(Database, fixture.db)),
    Layer.provide(Layer.succeed(EditorialMcpConfig, settings)),
  )

  const run = <A, E>(effect: Effect.Effect<A, E, EditorialMusicService>, trusted = true) => {
    const program = withTestLayer(effect, service).pipe(
      Effect.provideService(McpActor, principal),
      Effect.provideService(McpWireResponse, makeMcpWireResponse(1, 'json')),
    )

    return Effect.runPromise(
      trusted ? program.pipe(Effect.provideService(CommandAuthority, authority)) : program,
    )
  }

  const base = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
    MdxServiceLayer,
    UploadAssetServiceLayer,
    UnavailableObjectStoreClientLayer,
  ).pipe(Layer.provideMerge(DatabaseLayer(fixture.db.$client)))

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

  // Test composition only: central production registry remains owned by P1.
  const app = HttpRouter.toWebHandler(
    makeMcpRoutes(
      composeMcpToolkits(EditorialToolkit, EditorialMusicToolkit),
      EditorialMusicToolHandlersLayer.pipe(Layer.provide(EditorialMusicServiceLayer)),
    ).pipe(Layer.provide(services), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  )

  const call = async (
    name: string,
    input: Readonly<Record<string, string | ReadonlyArray<string>>>,
  ) => {
    const response = await app.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': name,
          authorization: `Bearer ${Redacted.value(tokens.access_token)}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name,
            arguments: input,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    )

    const text = await response.text()

    return {
      status: response.status,
      body: text.length === 0 ? null : JSON.parse(text),
      bytes: new TextEncoder().encode(text).byteLength,
    }
  }

  return {
    fixture,
    clientId,
    authority,
    settings,
    run,
    call,
    [Symbol.asyncDispose]: async () => {
      await app.dispose()
      await fixture[Symbol.asyncDispose]()
    },
  }
}

test('real OAuth HTTP create, tags and legacy update share versions and replay; preview has no writes', async () => {
  await using h = await harness()

  const created = await h.call('create_draft', {
    requestId: crypto.randomUUID(),
    title: 'OAuth draft',
    content: 'Source',
  })

  expect(created.status).toBe(200)

  const envelope = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: GetPostResult }) }),
  )(created.body)

  const original = envelope.result.structuredContent.post

  const input = {
    postId: original.postId,
    expectedVersion: original.version,
    requestId: crypto.randomUUID(),
    tags: ['😀', 'Ａ'],
  }

  const changed = await h.call('set_draft_tags', input)

  const result = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: GetPostResult }) }),
  )(changed.body).result.structuredContent

  expect(result.post.version).not.toBe(original.version)
  expect(result.post.tags).toEqual(['😀', 'Ａ'])

  const stale = await h.call('update_draft', {
    postId: original.postId,
    expectedVersion: original.version,
    requestId: crypto.randomUUID(),
    title: 'Stale',
  })

  expect(stale.body).toMatchObject({ result: { isError: true } })

  const updated = await h.call('update_draft', {
    postId: original.postId,
    expectedVersion: result.post.version,
    requestId: crypto.randomUUID(),
    title: 'Unicode title edit',
  })

  expect(updated.body).toMatchObject({
    result: { structuredContent: { post: { title: 'Unicode title edit', tags: ['😀', 'Ａ'] } } },
  })
  expect((await h.call('set_draft_tags', input)).body).toEqual(changed.body)

  const before = {
    posts: await h.fixture.db.select().from(postsTable),
    receipts: await h.fixture.db.select().from(editorialOperations),
  }

  expect(
    (
      await h.call('preview_editorial', {
        content: '## No save\n\n::music{type="track" id="missing"}',
      })
    ).body,
  ).toMatchObject({ result: { isError: false } })
  expect({
    posts: await h.fixture.db.select().from(postsTable),
    receipts: await h.fixture.db.select().from(editorialOperations),
  }).toEqual(before)
  await h.fixture.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, h.clientId))
  expect((await h.call('set_draft_tags', input)).status).toBe(401)
}, 20_000)

test('actual persisted OAuth revocation after preflight refuses CAS, mid-batch revocation rolls back and missing authority refuses', async () => {
  await using h = await harness()
  const postId = PostId.make(crypto.randomUUID())
  await h.fixture.db.insert(postsTable).values({
    id: postId,
    slug: postId,
    type: 'post',
    title: 'Original',
    content: 'Source',
    draft: true,
  })
  await h.fixture.db.insert(postCreators).values({ postId, creatorId: 'owner' })
  const previous = await Effect.runPromise(loadEditorialSnapshot(h.fixture.db, postId))
  const version = (await Effect.runPromise(projectPost(previous, h.settings))).version

  const input = {
    postId,
    expectedVersion: version,
    requestId: crypto.randomUUID(),
    tags: ['revocation'],
  }

  await expect(
    h.run(
      Effect.flatMap(EditorialMusicService, (s) => s.setDraftTags(input)),
      false,
    ),
  ).rejects.toMatchObject({ code: 'access_denied' })
  const checkpoint = await Effect.runPromise(h.authority.checkpoint(['posts:read', 'drafts:write']))
  await h.fixture.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, h.clientId))

  const receipt = {
    id: crypto.randomUUID(),
    actorId: h.fixture.userId,
    postId,
    inputHash: 'revoked',
    result: '{}',
    createdAt: new Date(),
  }

  await expect(
    Effect.runPromise(
      saveEditorialChange(
        h.fixture.db,
        h.fixture.userId,
        previous,
        { title: 'Missing wire context' },
        receipt,
        undefined,
        checkpoint.liveGuard,
      ),
    ),
  ).rejects.toMatchObject({ code: 'unavailable' })
  expect(
    await h.run(
      saveEditorialChange(
        h.fixture.db,
        h.fixture.userId,
        previous,
        { title: 'Must not save', tags: ['forbidden'] },
        receipt,
        undefined,
        checkpoint.liveGuard,
      ),
    ),
  ).toBe(false)
  expect(await h.fixture.db.select().from(editorialOperations)).toEqual([])
  expect((await Effect.runPromise(loadEditorialSnapshot(h.fixture.db, postId))).title).toBe(
    'Original',
  )
  await h.fixture.db
    .update(oauthClient)
    .set({ disabled: false })
    .where(eq(oauthClient.clientId, h.clientId))
  await h.fixture.db.$client
    .prepare(
      `CREATE TRIGGER revoke_editorial_client AFTER INSERT ON entity_labels BEGIN UPDATE oauth_client SET disabled = 1; END`,
    )
    .run()
  await expect(
    h.run(Effect.flatMap(EditorialMusicService, (s) => s.setDraftTags(input))),
  ).rejects.toMatchObject({ code: 'unavailable' })
  expect(await h.fixture.db.select().from(editorialOperations)).toEqual([])
  expect(await Effect.runPromise(loadEditorialSnapshot(h.fixture.db, postId))).toEqual(previous)
  expect(
    (await h.fixture.db.select().from(oauthClient).where(eq(oauthClient.clientId, h.clientId)))[0]
      ?.disabled,
  ).toBe(false)
  await h.fixture.db.$client.prepare('DROP TRIGGER revoke_editorial_client').run()
  const saved = await h.run(Effect.flatMap(EditorialMusicService, (s) => s.setDraftTags(input)))
  expect(saved.post.tags).toEqual(['revocation'])
  await h.fixture.db.update(oauthAccessToken).set({ expiresAt: new Date(0) })
  await expect(
    h.run(Effect.flatMap(EditorialMusicService, (s) => s.setDraftTags(input))),
  ).rejects.toMatchObject({ code: 'access_denied' })
  expect(await h.fixture.db.select().from(editorialOperations)).toHaveLength(1)
}, 20_000)

test('one guarded atomic save supports fifty mixed targets with a full prior snapshot and live OAuth fence', async () => {
  await using h = await harness()
  const db = h.fixture.db
  const postId = PostId.make(crypto.randomUUID())
  await db.insert(postsTable).values({
    id: postId,
    slug: postId,
    title: 'Full set',
    content: 'Source',
    type: 'post',
    draft: true,
  })
  await db.insert(postCreators).values({ postId, creatorId: h.fixture.userId })

  const types = ['playlist', 'track', 'album'] as const

  const targets = Array.from({ length: 50 }, (_, index) =>
    DraftMusicTarget.make({
      entityType: types[index % 3] ?? 'album',
      entityId: index === 7 ? crypto.randomUUID().toUpperCase() : crypto.randomUUID(),
    }),
  )

  for (const target of targets) {
    if (target.entityType === 'playlist')
      await db.insert(musicPlaylistsTable).values({
        id: target.entityId,
        slug: target.entityId,
        title: 'Public',
        publishedAt: new Date(0),
      })
    else
      await db
        .insert(target.entityType === 'track' ? musicTracksTable : musicAlbumsTable)
        .values({ id: target.entityId, slug: target.entityId, title: 'Catalogue' })
  }

  const primary = targets[38]

  if (!primary) throw new Error('Missing primary fixture')
  const references = { references: targets, primary }
  const now = new Date()
  const checkpoint = await Effect.runPromise(h.authority.checkpoint(['posts:read', 'drafts:write']))

  for (const title of ['First full set', 'Second full set']) {
    const previous = await Effect.runPromise(loadEditorialSnapshot(db, postId))
    expect(
      await h.run(
        saveEditorialChange(
          db,
          h.fixture.userId,
          previous,
          {
            title,
            tags: Array.from({ length: 20 }, (_, index) => `tag-${index}`),
            musicReferences: references,
          },
          {
            id: crypto.randomUUID(),
            actorId: h.fixture.userId,
            postId,
            inputHash: title,
            result: '{}',
            createdAt: new Date(),
          },
          draftMusicTargetsGuard(db, targets, now),
          checkpoint.liveGuard,
        ),
      ),
    ).toBe(true)
    expect((await Effect.runPromise(loadEditorialSnapshot(db, postId))).musicReferences).toEqual(
      references,
    )
  }

  const allowed = (collection: ReadonlyArray<typeof DraftMusicTarget.Type>) =>
    db.get(
      sql`SELECT CASE WHEN ${draftMusicTargetsGuard(db, collection, now)} THEN 1 ELSE 0 END AS allowed`,
    )

  expect(await allowed([])).toEqual({ allowed: 1 })
  const playlist = targets[0]
  const mixed = targets[7]

  if (!playlist || !mixed) throw new Error('Missing guard fixtures')
  await db
    .update(musicPlaylistsTable)
    .set({ publishedAt: null })
    .where(eq(musicPlaylistsTable.id, playlist.entityId))
  expect(await allowed(targets)).toEqual({ allowed: 0 })
  await db
    .update(musicPlaylistsTable)
    .set({ publishedAt: new Date(now.getTime() + 1) })
    .where(eq(musicPlaylistsTable.id, playlist.entityId))
  expect(await allowed(targets)).toEqual({ allowed: 0 })
  await db
    .update(musicPlaylistsTable)
    .set({ publishedAt: now })
    .where(eq(musicPlaylistsTable.id, playlist.entityId))
  expect(await allowed(targets)).toEqual({ allowed: 1 })
  expect(await allowed([{ ...mixed, entityId: mixed.entityId.toLowerCase() }])).toEqual({
    allowed: 0,
  })
  await db
    .insert(musicTracksTable)
    .values({ id: mixed.entityId.toLowerCase(), slug: 'case-collision', title: 'Collision' })
  expect(await allowed(targets)).toEqual({ allowed: 0 })
  expect(await allowed([{ entityType: 'album', entityId: crypto.randomUUID() }])).toEqual({
    allowed: 0,
  })
}, 20_000)

test('legacy draft create/update and source reads reject escaped wire overflow without saving or truncating', async () => {
  await using h = await harness()

  const input = {
    requestId: crypto.randomUUID(),
    title: 'Wire budget',
    content: '\\'.repeat(60_000),
  }

  for (const attempt of [1, 2]) {
    const response = await h.call('create_draft', input)
    expect(response.status, `attempt ${attempt}`).toBe(200)
    expect(response.body).toMatchObject({ result: { isError: true } })
    expect(JSON.stringify(response.body)).toContain('invalid_input')
    expect(response.bytes).toBeLessThanOrEqual(256 * 1024)
    expect(await h.fixture.db.select().from(postsTable)).toEqual([])
    expect(await h.fixture.db.select().from(editorialOperations)).toEqual([])
  }

  const postId = PostId.make(crypto.randomUUID())
  await h.fixture.db.insert(postsTable).values({
    id: postId,
    slug: postId,
    type: 'post',
    title: 'Existing',
    content: input.content,
    draft: true,
  })
  await h.fixture.db.insert(postCreators).values({ postId, creatorId: h.fixture.userId })
  const previous = await Effect.runPromise(loadEditorialSnapshot(h.fixture.db, postId))
  const expectedVersion = (await Effect.runPromise(projectPost(previous, h.settings))).version
  const read = await h.call('get_post', { postId })
  expect(read.body).toMatchObject({ result: { isError: true } })
  expect(JSON.stringify(read.body)).toContain('invalid_input')

  const changed = await h.call('update_draft', {
    postId,
    expectedVersion,
    requestId: crypto.randomUUID(),
    title: 'Must not commit',
  })

  expect(changed.body).toMatchObject({ result: { isError: true } })
  expect(JSON.stringify(changed.body)).toContain('invalid_input')
  expect(await Effect.runPromise(loadEditorialSnapshot(h.fixture.db, postId))).toEqual(previous)
  expect(await h.fixture.db.select().from(editorialOperations)).toEqual([])
}, 20_000)
