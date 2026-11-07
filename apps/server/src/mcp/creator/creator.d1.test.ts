import { PostId } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { audioCreators, audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import { favoritesTable } from '@/db/favorites.schema'
import { Database } from '@/db/layer'
import { oauthClient, oauthResource } from '@/db/oauth.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { showCreators, showsTable } from '@/db/show.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'
import { ConflictError, DatabaseError } from '@/errors'
import { makeMcpRoutes } from '@/http/editorial-mcp.routes'
import { AuthLive } from '@/lib/auth'
import { MdxServiceLayer } from '@/lib/mdx'
import { McpActor, McpAuthorizationLive } from '@/mcp/authorization'
import { CommandAuthority, makeOAuthCommandAuthority } from '@/mcp/command-authority'
import { EditorialMcpConfig } from '@/mcp/editorial'
import { loadEditorialSnapshot } from '@/mcp/editorial-music/snapshot'
import { EditorialMcpSettings, projectPost } from '@/mcp/model'
import { McpOperationStore, createMcpOperationStore, type JsonValue } from '@/mcp/operations/store'
import { composeMcpToolkits, EditorialToolkit } from '@/mcp/server'
import { AudioService, AudioServiceLayer } from '@/services/audio.service'
import { ConfigService } from '@/services/config.service'
import {
  CreatorCommandService,
  CreatorCommandServiceLayer,
} from '@/services/creator-command/service'
import { EditorialOAuth, EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { RecordingEmailTransportLayer } from '@/services/email-transport.service'
import { PostServiceLayer } from '@/services/post.service'
import { ShowService, ShowServiceLayer } from '@/services/show.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { withTestLayer } from '@/test/effect'

import {
  CreateMicroPostInput,
  CreatorCommandResult,
  DeleteContentInput,
  PublishEditorialInput,
  UnpublishContentInput,
  UpdateCreatorMetadataInput,
} from './contracts'
import { CreatorToolkit, CreatorToolHandlersLayer } from './toolkit'

const harness = async () => {
  const fixture = await createEditorialOAuthFixture()

  const scopes = [
    'creator:read',
    'creator:write',
    'posts:read',
    'drafts:write',
    'micros:publish',
    'content:publish',
    'content:delete',
    'offline_access',
  ]

  await fixture.register()
  await fixture.db.update(oauthResource).set({ allowedScopes: JSON.stringify(scopes) })
  const clientId = await fixture.register(scopes.join(' '))

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(clientId, await fixture.authorize(clientId, 'owner', scopes.join(' ')))
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

  const database = Layer.succeed(Database, fixture.db)

  const service = CreatorCommandServiceLayer.pipe(
    Layer.provide(McpAuthorizationLive.pipe(Layer.provide(database))),
    Layer.provide(Layer.succeed(McpOperationStore, createMcpOperationStore(fixture.database))),
    Layer.provide(
      Layer.succeed(
        EditorialMcpConfig,
        Schema.decodeUnknownSync(EditorialMcpSettings)({
          readScope: 'posts:read',
          environment: 'test',
          resourceUrl: fixture.config.mcp.resourceUrl,
          frontendUrl: fixture.config.urls.frontend,
        }),
      ),
    ),
    Layer.provide(database),
  )

  const run = <A, E>(effect: Effect.Effect<A, E, CreatorCommandService | CommandAuthority>) =>
    Effect.runPromise(
      withTestLayer(effect.pipe(Effect.provideService(CommandAuthority, authority)), service).pipe(
        Effect.provideService(McpActor, principal),
      ),
    )

  const browser = Layer.mergeAll(AudioServiceLayer, ShowServiceLayer).pipe(
    Layer.provide(MdxServiceLayer),
    Layer.provide(UnavailableObjectStoreClientLayer),
    Layer.provide(UploadAssetServiceLayer.pipe(Layer.provide(database))),
    Layer.provide(Layer.succeed(ConfigService, fixture.config)),
    Layer.provide(database),
  )

  const runBrowser = <A, E>(effect: Effect.Effect<A, E, AudioService | ShowService>) =>
    Effect.runPromise(withTestLayer(effect, browser))

  const base = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
    MdxServiceLayer,
    UnavailableObjectStoreClientLayer,
    UploadAssetServiceLayer,
  ).pipe(Layer.provideMerge(database))

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

  // Disposable HTTP composition only; the shared production registry remains P1-owned.
  const app = HttpRouter.toWebHandler(
    makeMcpRoutes(
      composeMcpToolkits(EditorialToolkit, CreatorToolkit),
      CreatorToolHandlersLayer.pipe(Layer.provide(service)),
    ).pipe(Layer.provide(services), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  )

  const call = async (name: string, input: JsonValue) => {
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

    const body = await response.text()

    return { status: response.status, body: body.length === 0 ? null : JSON.parse(body) }
  }

  return {
    fixture,
    run,
    runBrowser,
    call,
    clientId,
    [Symbol.asyncDispose]: async () => {
      await app.dispose()
      await fixture[Symbol.asyncDispose]()
    },
  }
}

test('real OAuth HTTP composes public micro creation and separately consented deletion without registry activation', async () => {
  await using h = await harness()
  const input = { requestId: crypto.randomUUID(), content: 'HTTP public micro' }
  const response = await h.call('create_micro_post', input)
  expect(response.status).toBe(200)

  const decode = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: CreatorCommandResult }) }),
  )

  const created = decode(response.body).result.structuredContent

  if (!('version' in created.target)) throw new Error('Expected post version')

  const target = {
    kind: 'micro',
    targetId: created.target.targetId,
    expectedVersion: created.target.version,
  }

  const request = { requestId: crypto.randomUUID(), target }
  const deleted = await h.call('delete_content', request)
  expect(deleted.status).toBe(200)
  const result = decode(deleted.body).result.structuredContent
  expect(result.target).toMatchObject({ targetId: created.target.targetId, state: 'deleted' })
  const replay = decode((await h.call('delete_content', request)).body).result.structuredContent
  expect(replay).toMatchObject({ target: result.target, replayed: true })
  expect(await h.fixture.db.select().from(postsTable)).toEqual([])
  await h.fixture.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, h.clientId))
  expect((await h.call('delete_content', request)).status).toBe(401)
}, 20_000)

test('live OAuth account authority is enforced inside the creation batch, not just at preflight', async () => {
  await using h = await harness()

  const input = Schema.decodeUnknownSync(CreateMicroPostInput)({
    requestId: crypto.randomUUID(),
    content: 'Must roll back',
  })

  await h.fixture.database
    .prepare(
      "CREATE TRIGGER creator_revoke_during_insert AFTER INSERT ON posts BEGIN UPDATE user SET banned=1 WHERE id='owner'; END",
    )
    .run()
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.createMicroPost(input))),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
  expect(await h.fixture.db.select().from(postsTable)).toEqual([])
  expect(await h.fixture.db.select().from(postCreators)).toEqual([])
  expect(
    await h.fixture.db.select({ banned: user.banned }).from(user).where(eq(user.id, 'owner')),
  ).toEqual([{ banned: false }])
  await h.fixture.database.prepare('DROP TRIGGER creator_revoke_during_insert').run()
  expect(
    await h.run(Effect.flatMap(CreatorCommandService, (s) => s.createMicroPost(input))),
  ).toMatchObject({ replayed: false, target: { state: 'published' } })
}, 20_000)

test('real OAuth creator metadata is owner-only, revision guarded and receipt replay rechecks current access', async () => {
  await using h = await harness()

  const mixId = crypto.randomUUID(),
    otherId = crypto.randomUUID(),
    showId = crypto.randomUUID(),
    publishedId = crypto.randomUUID()

  const now = new Date()

  for (const [id, owner, draft] of [
    [mixId, 'owner', true],
    [otherId, 'other', true],
    [publishedId, 'owner', false],
  ] as const) {
    await h.fixture.db.insert(audioTable).values({
      id,
      title: id,
      slug: id,
      content: 'private body',
      url: 'private secret URL',
      type: 'mix',
      draft,
      createdAt: now,
      updatedAt: now,
    })
    await h.fixture.db.insert(audioCreators).values({ audioId: id, creatorId: owner })
  }

  await h.fixture.db.insert(showsTable).values({
    id: showId,
    title: 'Show',
    slug: showId,
    content: 'private body',
    draft: true,
    createdAt: now,
    updatedAt: now,
  })
  await h.fixture.db.insert(showCreators).values({ showId, creatorId: 'owner' })
  const listing = await h.run(Effect.flatMap(CreatorCommandService, (s) => s.listCreatorDrafts({})))
  expect(listing.drafts.map((x) => x.targetId).sort()).toEqual([mixId, showId].sort())
  expect(JSON.stringify(listing)).not.toContain('private body')
  expect(JSON.stringify(listing)).not.toContain('private secret URL')

  const input = Schema.decodeUnknownSync(UpdateCreatorMetadataInput)({
    requestId: crypto.randomUUID(),
    kind: 'mix',
    targetId: mixId,
    expectedRevision: 0,
    title: 'Changed',
    description: null,
  })

  const apply = () =>
    h.run(Effect.flatMap(CreatorCommandService, (s) => s.updateCreatorMetadata(input)))

  const outcomes = await Promise.all([apply(), apply()])
  expect(outcomes.map((x) => x.target)).toEqual([outcomes[0]?.target, outcomes[0]?.target])
  expect(outcomes.some((x) => x.replayed)).toBe(true)
  expect(
    await h.fixture.db
      .select({ title: audioTable.title, revision: audioTable.revision })
      .from(audioTable)
      .where(eq(audioTable.id, mixId)),
  ).toEqual([{ title: 'Changed', revision: 1 }])

  const changed = await h.run(
    Effect.result(
      Effect.flatMap(CreatorCommandService, (s) =>
        s.updateCreatorMetadata({ ...input, title: 'Different' }),
      ),
    ),
  )

  expect(changed).toMatchObject({ failure: { code: 'conflict' } })

  const stale = await h.run(
    Effect.result(
      Effect.flatMap(CreatorCommandService, (s) =>
        s.updateCreatorMetadata({ ...input, requestId: crypto.randomUUID() }),
      ),
    ),
  )

  expect(stale).toMatchObject({ failure: { code: 'conflict' } })

  for (const targetId of [otherId, publishedId]) {
    const denied = await h.run(
      Effect.result(
        Effect.flatMap(CreatorCommandService, (s) =>
          s.updateCreatorMetadata({ ...input, requestId: crypto.randomUUID(), targetId }),
        ),
      ),
    )

    expect(denied).toMatchObject({ failure: { code: 'not_found' } })
  }

  await h.fixture.db.delete(audioCreators).where(eq(audioCreators.audioId, mixId))
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.updateCreatorMetadata(input))),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
  await h.fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  expect(
    (
      await h.run(
        Effect.flatMap(CreatorCommandService, (s) => s.listCreatorDrafts({ kind: 'mix' })),
      )
    ).drafts,
  ).toEqual([])
  await h.fixture.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, h.clientId))
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.updateCreatorMetadata(input))),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
}, 20_000)

test('browser show deletion versions detached episodes atomically and refuses child revision overflow', async () => {
  await using h = await harness()

  const showId = crypto.randomUUID(),
    episodeId = crypto.randomUUID()

  await h.fixture.db
    .insert(showsTable)
    .values({ id: showId, slug: showId, title: 'Show', content: '', draft: true })
  await h.fixture.db.insert(showCreators).values({ showId, creatorId: 'owner' })
  await h.fixture.db.insert(audioTable).values({
    id: episodeId,
    slug: episodeId,
    title: 'Keep episode',
    description: 'Unrelated prose',
    content: 'Body',
    type: 'mix',
    url: 'https://example.test/episode.mp3',
    showId,
    episodeNumber: 7,
    revision: Number.MAX_SAFE_INTEGER,
  })
  const before = await h.fixture.db.select().from(audioTable)
  expect(
    await h.runBrowser(
      Effect.result(Effect.flatMap(ShowService, (s) => s.delete(showId, 'owner', 'editor'))),
    ),
  ).toMatchObject({ failure: expect.any(ConflictError) })
  expect(await h.fixture.db.select().from(audioTable)).toEqual(before)
  expect(await h.fixture.db.select().from(showsTable)).toHaveLength(1)
  await h.fixture.db.update(audioTable).set({ revision: 8 }).where(eq(audioTable.id, episodeId))
  const [episode] = await h.fixture.db.select().from(audioTable)

  if (!episode) throw new Error('Missing seeded episode')
  await h.runBrowser(Effect.flatMap(ShowService, (s) => s.delete(showId, 'owner', 'editor')))
  const [detached] = await h.fixture.db.select().from(audioTable)
  expect(detached).toEqual({
    ...episode,
    showId: null,
    revision: 9,
    lastOperationId: expect.any(String),
    updatedAt: expect.any(Date),
  })
  expect(detached?.updatedAt.getTime()).toBeGreaterThan(episode.updatedAt.getTime())
  expect(detached?.lastOperationId).toHaveLength(36)
  expect(await h.fixture.db.select().from(showsTable)).toEqual([])
}, 20_000)

test('public micro create retries commit one post and return the shared version for separately consented unpublish', async () => {
  await using h = await harness()

  const input = Schema.decodeUnknownSync(CreateMicroPostInput)({
    requestId: crypto.randomUUID(),
    content: 'Public **micro**',
  })

  const apply = () => h.run(Effect.flatMap(CreatorCommandService, (s) => s.createMicroPost(input)))
  const [first, retry] = await Promise.all([apply(), apply()])
  expect(first.target).toEqual(retry.target)
  expect(first.target).toMatchObject({ kind: 'micro', state: 'published' })
  const rows = await h.fixture.db.select().from(postsTable)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    id: first.target.targetId,
    content: 'Public **micro**',
    draft: false,
    depth: 0,
    parentPostId: null,
    rootPostId: null,
  })
  const id = Schema.decodeUnknownSync(PostId)(first.target.targetId)

  const settings = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'test',
    resourceUrl: h.fixture.config.mcp.resourceUrl,
    frontendUrl: h.fixture.config.urls.frontend,
  })

  const current = await Effect.runPromise(
    Effect.flatMap(loadEditorialSnapshot(h.fixture.db, id), (snapshot) =>
      projectPost(snapshot, settings),
    ),
  )

  expect(first.target).toMatchObject({ version: current.version })

  const transition = Schema.decodeUnknownSync(UnpublishContentInput)({
    requestId: crypto.randomUUID(),
    target: { kind: 'micro', targetId: id, expectedVersion: current.version },
  })

  const result = await h.run(
    Effect.flatMap(CreatorCommandService, (s) => s.unpublishContent(transition)),
  )

  expect(result.target).toMatchObject({ kind: 'micro', state: 'unpublished' })
  expect(result.target).not.toMatchObject({ version: current.version })
  expect((await h.fixture.db.select().from(postsTable))[0]?.draft).toBe(true)
  expect(
    await h.run(Effect.flatMap(CreatorCommandService, (s) => s.unpublishContent(transition))),
  ).toMatchObject({ target: result.target, replayed: true })

  const changed = await h.run(
    Effect.result(
      Effect.flatMap(CreatorCommandService, (s) =>
        s.createMicroPost({ ...input, content: 'Changed retry' }),
      ),
    ),
  )

  expect(changed).toMatchObject({ failure: { code: 'conflict' } })

  const malformed = Schema.decodeUnknownSync(CreateMicroPostInput)({
    requestId: crypto.randomUUID(),
    content: '<script>alert(1)</script>',
  })

  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.createMicroPost(malformed))),
    ),
  ).toMatchObject({ failure: { code: 'invalid_input' } })
  expect(await h.fixture.db.select().from(postsTable)).toHaveLength(1)
}, 20_000)

test('editorial publish uses shared version CAS; replay acknowledges transition but never bypasses current ownership', async () => {
  await using h = await harness()
  const id = Schema.decodeUnknownSync(PostId)(crypto.randomUUID())
  await h.fixture.db.insert(postsTable).values({
    id,
    slug: id,
    title: 'Editorial',
    content: 'Canonical **prose**',
    type: 'post',
    draft: true,
  })
  await h.fixture.db.insert(postCreators).values({ postId: id, creatorId: 'owner' })

  const settings = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'test',
    resourceUrl: h.fixture.config.mcp.resourceUrl,
    frontendUrl: h.fixture.config.urls.frontend,
  })

  const current = await Effect.runPromise(
    Effect.flatMap(loadEditorialSnapshot(h.fixture.db, id), (snapshot) =>
      projectPost(snapshot, settings),
    ),
  )

  const input = Schema.decodeUnknownSync(PublishEditorialInput)({
    requestId: crypto.randomUUID(),
    postId: id,
    expectedVersion: current.version,
  })

  const first = await h.run(Effect.flatMap(CreatorCommandService, (s) => s.publishEditorial(input)))
  expect(first.target).toMatchObject({ kind: 'post', targetId: id, state: 'published' })
  expect((await h.fixture.db.select().from(postsTable))[0]?.draft).toBe(false)
  expect(
    await h.run(Effect.flatMap(CreatorCommandService, (s) => s.publishEditorial(input))),
  ).toMatchObject({ target: first.target, replayed: true })
  expect(
    await h.run(
      Effect.result(
        Effect.flatMap(CreatorCommandService, (s) =>
          s.publishEditorial({ ...input, requestId: crypto.randomUUID() }),
        ),
      ),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
  await h.fixture.db.delete(postCreators).where(eq(postCreators.postId, id))
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.publishEditorial(input))),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
}, 20_000)

test('browser and MCP share revisions; rejected coupled creator/tag saves roll back together', async () => {
  await using h = await harness()

  const mixId = crypto.randomUUID(),
    showId = crypto.randomUUID()

  await h.fixture.db.insert(audioTable).values({
    id: mixId,
    title: 'Original',
    slug: mixId,
    content: '',
    url: 'https://example.test/mix.mp3',
    type: 'mix',
    draft: true,
  })
  await h.fixture.db.insert(audioCreators).values({ audioId: mixId, creatorId: 'owner' })
  await h.fixture.db
    .insert(showsTable)
    .values({ id: showId, title: 'Original show', slug: showId, content: '', draft: true })
  await h.fixture.db.insert(showCreators).values({ showId, creatorId: 'owner' })

  const first = await h.runBrowser(
    Effect.flatMap(AudioService, (s) =>
      s.update('mix', mixId, 'owner', 'editor', {
        title: 'Browser',
        tags: ['new tag'],
        expectedRevision: 0,
      }),
    ),
  )

  expect(first).toMatchObject({ title: 'Browser', revision: 1, tags: ['new tag'] })

  const input = Schema.decodeUnknownSync(UpdateCreatorMetadataInput)({
    kind: 'mix',
    targetId: mixId,
    requestId: crypto.randomUUID(),
    title: 'MCP',
    expectedRevision: 0,
  })

  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.updateCreatorMetadata(input))),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
  expect(
    await h.runBrowser(
      Effect.result(
        Effect.flatMap(AudioService, (s) =>
          s.update('mix', mixId, 'owner', 'editor', {
            title: 'Stale browser',
            expectedRevision: 0,
          }),
        ),
      ),
    ),
  ).toMatchObject({ failure: expect.any(ConflictError) })
  expect(
    await h.runBrowser(
      Effect.result(
        Effect.flatMap(AudioService, (s) =>
          s.update('mix', mixId, 'owner', 'editor', {
            title: 'Broken',
            tags: ['bad'],
            creatorIds: ['nonexistent'],
            expectedRevision: 1,
          }),
        ),
      ),
    ),
  ).toMatchObject({ failure: expect.any(DatabaseError) })
  expect(
    await h.fixture.db
      .select({ title: audioTable.title, revision: audioTable.revision })
      .from(audioTable)
      .where(eq(audioTable.id, mixId)),
  ).toEqual([{ title: 'Browser', revision: 1 }])
  expect(
    await h.fixture.db
      .select({ name: labelsTable.name })
      .from(entityLabelsTable)
      .innerJoin(labelsTable, eq(entityLabelsTable.labelId, labelsTable.id))
      .where(eq(entityLabelsTable.entityId, mixId)),
  ).toEqual([{ name: 'new tag' }])

  const show = await h.runBrowser(
    Effect.flatMap(ShowService, (s) =>
      s.update(showId, 'owner', 'editor', {
        title: 'Changed show',
        tags: ['show tag'],
        expectedRevision: 0,
      }),
    ),
  )

  expect(show).toMatchObject({ title: 'Changed show', revision: 1, tags: ['show tag'] })
  await h.fixture.db
    .update(audioTable)
    .set({ revision: Number.MAX_SAFE_INTEGER })
    .where(eq(audioTable.id, mixId))
  expect(
    await h.runBrowser(
      Effect.result(
        Effect.flatMap(AudioService, (s) =>
          s.update('mix', mixId, 'owner', 'editor', { title: 'Overflow' }),
        ),
      ),
    ),
  ).toMatchObject({ failure: expect.any(ConflictError) })
}, 20_000)

test('delete proves a physical winner, refuses dependent state and replays only the exact authorized outcome', async () => {
  await using h = await harness()

  const mixId = crypto.randomUUID(),
    showId = crypto.randomUUID()

  await h.fixture.db.insert(audioTable).values({
    id: mixId,
    title: 'Delete mix',
    slug: mixId,
    content: 'unchanged',
    url: 'https://example.test/public.mp3',
    type: 'mix',
    draft: false,
  })
  await h.fixture.db.insert(audioCreators).values({ audioId: mixId, creatorId: 'owner' })
  await h.fixture.db
    .insert(showsTable)
    .values({ id: showId, title: 'Delete show', slug: showId, content: '', draft: true })
  await h.fixture.db.insert(showCreators).values({ showId, creatorId: 'owner' })

  const input = Schema.decodeUnknownSync(DeleteContentInput)({
    requestId: crypto.randomUUID(),
    target: { kind: 'mix', targetId: mixId, expectedRevision: 0 },
  })

  const apply = () => h.run(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input)))
  await h.fixture.db.insert(favoritesTable).values({ userId: 'other', audioId: mixId })
  const before = await h.fixture.db.select().from(audioTable)
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input))),
    ),
  ).toMatchObject({ failure: { code: 'conflict' } })
  expect(await h.fixture.db.select().from(audioTable)).toEqual(before)
  expect(await h.fixture.db.select().from(audioCreators)).toEqual([
    { audioId: mixId, creatorId: 'owner' },
  ])
  expect(await h.fixture.db.select().from(favoritesTable)).toHaveLength(1)
  await h.fixture.db.delete(favoritesTable)
  const [first, retry] = await Promise.all([apply(), apply()])
  expect(first.target).toEqual({ kind: 'mix', targetId: mixId, revision: 1, state: 'deleted' })
  expect(retry.target).toEqual(first.target)
  expect([first.replayed, retry.replayed].filter(Boolean)).toHaveLength(1)
  expect(await h.fixture.db.select().from(audioTable)).toEqual([])
  expect(await h.fixture.db.select().from(audioCreators)).toEqual([])

  const showInput = Schema.decodeUnknownSync(DeleteContentInput)({
    requestId: crypto.randomUUID(),
    target: { kind: 'show', targetId: showId, expectedRevision: 0 },
  })

  expect(
    await h.run(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(showInput))),
  ).toMatchObject({ target: { kind: 'show', state: 'deleted', revision: 1 } })
  expect(await h.fixture.db.select().from(showCreators)).toEqual([])
  expect(
    await h.run(
      Effect.result(
        Effect.flatMap(CreatorCommandService, (s) =>
          s.deleteContent({ ...input, requestId: crypto.randomUUID() }),
        ),
      ),
    ),
  ).toMatchObject({ failure: { code: 'not_found' } })
  // An ID reused by another owner cannot inherit the old receipt's authority.
  await h.fixture.db.insert(audioTable).values({
    id: mixId,
    title: 'Other owner',
    slug: mixId,
    content: '',
    url: '',
    type: 'mix',
    draft: true,
  })
  await h.fixture.db.insert(audioCreators).values({ audioId: mixId, creatorId: 'other' })
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input))),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
}, 20_000)

test('post deletion rolls back its stamp and owned relations on storage failure, then returns replayable deletion', async () => {
  await using h = await harness()

  const created = await h.run(
    Effect.flatMap(CreatorCommandService, (s) =>
      s.createMicroPost(
        Schema.decodeUnknownSync(CreateMicroPostInput)({
          requestId: crypto.randomUUID(),
          content: 'Delete only this micro',
        }),
      ),
    ),
  )

  if (!('version' in created.target)) throw new Error('Expected micro result')
  const id = created.target.targetId
  const labelId = crypto.randomUUID()
  await h.fixture.db
    .insert(labelsTable)
    .values({ id: labelId, kind: 'tag', name: 'Preserved on failure' })
  await h.fixture.db
    .insert(entityLabelsTable)
    .values({ entityType: 'post', entityId: id, labelId, position: 0 })

  const settings = Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'test',
    resourceUrl: h.fixture.config.mcp.resourceUrl,
    frontendUrl: h.fixture.config.urls.frontend,
  })

  const postId = Schema.decodeUnknownSync(PostId)(id)

  const observed = await Effect.runPromise(
    Effect.flatMap(loadEditorialSnapshot(h.fixture.db, postId), (snapshot) =>
      projectPost(snapshot, settings),
    ),
  )

  const input = Schema.decodeUnknownSync(DeleteContentInput)({
    requestId: crypto.randomUUID(),
    target: { kind: 'micro', targetId: id, expectedVersion: observed.version },
  })

  const rows = await h.fixture.db.select().from(postsTable)
  await h.fixture.database
    .prepare(
      "CREATE TRIGGER creator_delete_failure BEFORE DELETE ON posts BEGIN SELECT RAISE(ABORT,'test failure'); END",
    )
    .run()
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input))),
    ),
  ).toMatchObject({ failure: { code: 'unavailable' } })
  expect(await h.fixture.db.select().from(postsTable)).toEqual(rows)
  expect(await h.fixture.db.select().from(postCreators)).toEqual([
    { postId: id, creatorId: 'owner' },
  ])
  expect(await h.fixture.db.select().from(entityLabelsTable)).toEqual([
    { entityType: 'post', entityId: id, labelId, position: 0 },
  ])
  await h.fixture.database.prepare('DROP TRIGGER creator_delete_failure').run()
  const applied = await h.run(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input)))
  expect(applied.target).toMatchObject({ kind: 'micro', targetId: id, state: 'deleted' })
  expect(await h.fixture.db.select().from(postsTable)).toEqual([])
  expect(await h.fixture.db.select().from(entityLabelsTable)).toEqual([])
  expect(
    await h.run(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input))),
  ).toMatchObject({ target: applied.target, replayed: true })
  await h.fixture.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, h.clientId))
  expect(
    await h.run(
      Effect.result(Effect.flatMap(CreatorCommandService, (s) => s.deleteContent(input))),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
}, 20_000)
