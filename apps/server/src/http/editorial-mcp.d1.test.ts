import { UserId } from '@gbfm/core/identity'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Match, Redacted, Schema } from 'effect'
import { expect, test } from 'vitest'

import { audioArtists, audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import {
  listeningCollectionsTable,
  listeningMembershipsTable,
  savedMixesTable,
} from '@/db/listening.schema'
import { musicArtistsTable } from '@/db/music-entity.schema'
import { oauthClient, oauthConsent, oauthResource } from '@/db/oauth.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { showsTable } from '@/db/show.schema'
import { ExternalMediaFetcher } from '@/lib/external-media'
import {
  PublishedPostsResult,
  PublicShowResult,
  ShowEpisodesResult,
} from '@/mcp/content-read/contracts'
import {
  PublicCollectionResult,
  PublicMixResult,
  PublicProfileResult,
  PublicSearchResult,
} from '@/mcp/content-read/research-contracts'
import { GetPostResult } from '@/mcp/contracts'
import { ConfigService, createConfig } from '@/services/config.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { createTestWebHandler } from '@/test/http-handler'
import { createComposedMcpFixture } from '@/test/mcp-catalogue-fixture'

const ToolList = Schema.Struct({
  result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
})

const ReadResult = Schema.Struct({
  result: Schema.Struct({
    structuredContent: Schema.Struct({
      endpoint: Schema.Struct({ environment: Schema.String, resourceUrl: Schema.String }),
      posts: Schema.Array(Schema.Struct({ postId: Schema.String })),
    }),
  }),
})

test('composed OAuth MCP enforces draft-write consent, saved versions and revocation', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const clientId = await fixture.register()

  const readTokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
  )

  const writeTokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(
        clientId,
        await fixture.authorize(clientId, 'owner', 'posts:read offline_access drafts:write'),
      )
    ).json(),
  )

  const handler = createTestWebHandler(
    fixture.db.$client,
    undefined,
    undefined,
    undefined,
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
  )

  const call = (name: string, args: Schema.Json, token = writeTokens.access_token, padding = 0) =>
    handler.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': name,
          authorization: `Bearer ${Redacted.value(token)}`,
        },
        body:
          JSON.stringify({
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
          }) + ' '.repeat(padding),
      }),
    )

  const Saved = Schema.Struct({ result: Schema.Struct({ structuredContent: GetPostResult }) })

  const input = {
    requestId: crypto.randomUUID(),
    title: 'An ode to jazz',
    content: 'A disposable editorial draft.',
  }

  try {
    const denied = await call('create_draft', input, readTokens.access_token)
    expect(denied.status).toBe(200)
    expect(await denied.json()).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
    })

    const oversizedRead = await call(
      'get_post',
      { postId: 'x'.repeat(20_000) },
      readTokens.access_token,
    )

    expect(oversizedRead.status).toBe(413)
    const created = await call('create_draft', input)
    expect(created.status).toBe(200)
    expect(created.headers.get('cache-control')).toBe('private, no-store')
    const saved = Schema.decodeUnknownSync(Saved)(await created.json()).result.structuredContent

    const maximumInput = {
      requestId: crypto.randomUUID(),
      title: 'x'.repeat(500),
      content: '\u0001'.repeat(100_000),
      description: '\u0001'.repeat(2000),
    }

    // D5 tightens the former 640 KiB envelope: valid character counts can exceed JSON bytes.
    expect((await call('create_draft', maximumInput)).status).toBe(413)

    const maximum = await call('create_draft', {
      ...maximumInput,
      content: 'x'.repeat(100_000),
      description: 'x'.repeat(2000),
    })

    expect(maximum.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Saved)(await maximum.json()).result.structuredContent.post.content,
    ).toBe('x'.repeat(100_000))
    expect(
      await (
        await call('create_draft', {
          ...input,
          requestId: crypto.randomUUID(),
          content: 'x'.repeat(100_001),
        })
      ).json(),
    ).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('100000') }] },
    })

    // Padding is legal JSON whitespace: transport limits are independent of field limits.
    const boundaryInput = { ...input, requestId: crypto.randomUUID(), content: 'é🎵' }

    const measured = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'create_draft',
        arguments: boundaryInput,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    })

    const padding = 256 * 1024 - new TextEncoder().encode(measured).byteLength
    expect(
      (await call('create_draft', boundaryInput, writeTokens.access_token, padding)).status,
    ).toBe(200)
    expect(
      (await call('create_draft', boundaryInput, writeTokens.access_token, padding + 1)).status,
    ).toBe(413)

    // A small request must not leak an oversized stored response or truncate its content.
    await fixture.db
      .update(postsTable)
      .set({ content: '\u0001'.repeat(100_000) })
      .where(eq(postsTable.id, saved.post.postId))
    const oversizedResponse = await call('get_post', { postId: saved.post.postId })
    expect(oversizedResponse.status).toBe(413)
    expect(await oversizedResponse.text()).toBe('MCP response exceeds the supported byte limit.')
    await fixture.db
      .update(postsTable)
      .set({ content: input.content })
      .where(eq(postsTable.id, saved.post.postId))
    expect((await call('create_draft', { ...input, content: 'x'.repeat(700_000) })).status).toBe(
      413,
    )
    expect(saved.post).toMatchObject({ creatorIds: ['owner'], draft: true, title: input.title })

    const update = {
      requestId: crypto.randomUUID(),
      postId: saved.post.postId,
      expectedVersion: saved.post.version,
      content: 'A jazz thought. '.repeat(2000),
    }

    const updated = await call('update_draft', update)
    expect(updated.status).toBe(200)
    const next = Schema.decodeUnknownSync(Saved)(await updated.json()).result.structuredContent
    expect(next.post.content).toBe(update.content)

    const saveFromBrowser = (expectedUpdatedAt: string, content: string) =>
      handler.handler(
        new Request(`https://editorial-test.localhost/api/content/posts/${next.post.slug}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer owner-session-token',
          },
          body: JSON.stringify({ expectedUpdatedAt, content }),
        }),
      )

    const staleBrowser = await saveFromBrowser(saved.post.updatedAt, 'Stale browser text')
    expect(staleBrowser.status).toBe(409)

    const concurrentBrowser = await Promise.all(
      ['Browser edit one', 'Browser edit two'].map((content) =>
        saveFromBrowser(next.post.updatedAt, content),
      ),
    )

    expect(concurrentBrowser.map((response) => response.status).toSorted((a, b) => a - b)).toEqual([
      200, 409,
    ])
    const replay = await call('update_draft', update)
    expect(Schema.decodeUnknownSync(Saved)(await replay.json()).result.structuredContent).toEqual(
      next,
    )

    const deniedUpdate = await call(
      'update_draft',
      {
        ...update,
        content: 'Denied write',
        requestId: crypto.randomUUID(),
        expectedVersion: next.post.version,
      },
      readTokens.access_token,
    )

    expect(await deniedUpdate.json()).toMatchObject({ result: { isError: true } })

    await fixture.db.update(user).set({ banned: true }).where(eq(user.id, 'owner'))
    expect((await call('create_draft', { ...input, requestId: crypto.randomUUID() })).status).toBe(
      401,
    )
    await fixture.db.update(user).set({ banned: false }).where(eq(user.id, 'owner'))
    await Effect.runPromise(fixture.service.disconnect(fixture.userId, clientId))
    expect((await call('update_draft', update)).status).toBe(401)

    const [persisted] = await fixture.db
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, next.post.postId))

    expect(persisted?.draft).toBe(true)
    expect(['Browser edit one', 'Browser edit two']).toContain(persisted?.content)
  } finally {
    await handler.dispose()
  }
}, 30_000)

test('composed API serves connection instructions without OAuth while MCP stays protected', async () => {
  await using fixture = await createEditorialOAuthFixture()
  // A never-seeded database must support the first metadata request, not only retries.
  await fixture.db.delete(oauthResource)

  const handler = createTestWebHandler(
    fixture.db.$client,
    undefined,
    undefined,
    undefined,
    Layer.succeed(ConfigService, fixture.config),
  )

  try {
    const metadataUrl = 'https://editorial-test.localhost/.well-known/oauth-protected-resource/mcp'
    const metadata = await handler.handler(new Request(metadataUrl))
    expect(metadata.status).toBe(200)
    expect(await metadata.json()).toMatchObject({
      scopes_supported: ['drafts:write', 'posts:read'],
    })
    expect(await fixture.db.select().from(oauthResource)).toHaveLength(1)
    // Once initialization completed, missing policy must still fail closed.
    await fixture.db.delete(oauthResource)
    expect((await handler.handler(new Request(metadataUrl))).status).toBe(503)

    const guide = await handler.handler(new Request('https://editorial-test.localhost/mcp.txt'))

    expect(guide.status).toBe(200)
    expect(guide.headers.get('content-type')).toContain('text/plain')
    expect(await guide.text()).toContain('Server URL: https://editorial-test.localhost/mcp')

    const protocol = await handler.handler(new Request('https://editorial-test.localhost/mcp'))

    expect(protocol.status).toBe(401)
    expect(protocol.headers.get('www-authenticate')).toContain('Bearer')
  } finally {
    await handler.dispose()
  }
})

test('invalid optional MCP settings isolate failure from health and existing authentication', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const clientId = await fixture.register()

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
  )

  const config = createConfig({
    APP_STAGE: 'test',
    SHARE_URL: 'https://user:synthetic-private@invalid.test',
    FRONTEND_URL: 'https://editorial-test.localhost',
    USER_CONTENT_BUCKET_NAME: 'disposable',
    MIXES_BUCKET_NAME: 'disposable',
    StorageRegion: 'auto',
    BETTER_AUTH_SECRET: 'disposable-test-secret-with-at-least-32-chars',
    BETTER_AUTH_URL: 'https://editorial-test.localhost',
    SpotifyClientId: '',
    SpotifyClientSecret: '',
    SENTRY_BACKEND_DSN: '',
    VITE_PUBLIC_SENTRY_DSN: '',
    CloudflareAnalyticsApiToken: '',
  })

  const handler = createTestWebHandler(
    fixture.db.$client,
    undefined,
    undefined,
    undefined,
    Layer.succeed(ConfigService, config),
  )

  try {
    expect(
      (await handler.handler(new Request('https://editorial-test.localhost/health/live'))).status,
    ).toBe(200)
    expect(
      (await handler.handler(new Request('https://editorial-test.localhost/auth/get-session')))
        .status,
    ).toBe(200)
    expect(
      (await handler.handler(new Request('https://editorial-test.localhost/mcp'))).status,
    ).toBe(503)

    const connections = await handler.handler(
      new Request('https://editorial-test.localhost/api/user/mcp-connections', {
        headers: { authorization: 'Bearer owner-session-token' },
      }),
    )

    expect(connections.status).toBe(200)
    expect(await connections.json()).toMatchObject({ connections: [{ clientId }] })

    const revoked = await handler.handler(
      new Request(`https://editorial-test.localhost/api/user/mcp-connections/${clientId}/revoke`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-session-token',
          origin: 'https://editorial-test.localhost',
          'sec-fetch-site': 'same-origin',
        },
      }),
    )

    expect(revoked.status).toBe(200)
    expect(await revoked.json()).toEqual({ success: true })
    expect(
      await Effect.runPromise(fixture.service.verify(tokens.access_token).pipe(Effect.result)),
    ).toHaveProperty('_tag', 'Failure')
  } finally {
    await handler.dispose()
  }
})

test('composed HTTP MCP scopes tokens, drafts, connections and disconnection to the approving user', async () => {
  await using fixture = await createEditorialOAuthFixture()
  await fixture.db.update(user).set({ role: 'editor' }).where(eq(user.id, 'owner'))
  await fixture.db.insert(postsTable).values({
    id: 'composed-draft',
    type: 'post',
    title: 'Disposable editorial draft',
    slug: 'composed-editorial-draft',
    content: 'Private disposable fixture.',
    draft: true,
  })
  await fixture.db.insert(postCreators).values({ postId: 'composed-draft', creatorId: 'owner' })
  await fixture.db.insert(postsTable).values({
    id: 'other-composed-draft',
    type: 'post',
    title: 'Other author draft',
    slug: 'other-composed-draft',
    content: 'Other private fixture.',
    draft: true,
  })
  await fixture.db
    .insert(postCreators)
    .values({ postId: 'other-composed-draft', creatorId: 'other' })

  const clientId = await fixture.register()

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
  )

  const otherTokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (await fixture.exchange(clientId, await fixture.authorize(clientId, 'other'))).json(),
  )

  const otherClientId = await fixture.register()
  await fixture.authorize(otherClientId, 'other')

  const handler = createTestWebHandler(
    fixture.db.$client,
    undefined,
    undefined,
    undefined,
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
  )

  const rpc = (method: string, token?: Redacted.Redacted, name?: string, origin?: string) =>
    handler.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': method,
          ...(name ? { 'mcp-name': name } : undefined),
          ...(origin ? { origin } : undefined),
          ...(token ? { authorization: `Bearer ${Redacted.value(token)}` } : undefined),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params: {
            ...(name ? { name, arguments: {} } : undefined),
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    )

  try {
    const unauthorized = await rpc('tools/list')
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get('www-authenticate')).toContain(
      '/.well-known/oauth-protected-resource/mcp',
    )
    expect(unauthorized.headers.get('www-authenticate')).toContain('scope="posts:read"')
    expect(unauthorized.headers.get('cache-control')).toBe('private, no-store')
    expect((await rpc('server/discover')).status).toBe(401)
    expect((await rpc('tools/list', Redacted.make('owner-session-token'))).status).toBe(401)

    const browserUnauthorized = await rpc(
      'tools/list',
      undefined,
      undefined,
      fixture.config.urls.frontend,
    )

    expect(browserUnauthorized.status).toBe(401)
    expect(browserUnauthorized.headers.get('access-control-allow-origin')).toBe(
      fixture.config.urls.frontend,
    )
    expect(
      browserUnauthorized.headers.get('access-control-expose-headers')?.toLowerCase(),
    ).toContain('www-authenticate')

    const preflight = await handler.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'OPTIONS',
        headers: {
          origin: fixture.config.urls.frontend,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,mcp-protocol-version',
        },
      }),
    )

    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(fixture.config.urls.frontend)

    const listed = await rpc('tools/list', tokens.access_token)
    expect(listed.status).toBe(200)
    expect(Schema.decodeUnknownSync(ToolList)(await listed.json()).result.tools).toEqual([
      { name: 'list_drafts' },
      { name: 'get_post' },
    ])

    const read = await rpc('tools/call', tokens.access_token, 'list_drafts')
    expect(read.status).toBe(200)
    const result = Schema.decodeUnknownSync(ReadResult)(await read.json()).result.structuredContent
    expect(result.endpoint).toMatchObject({
      environment: 'local',
      resourceUrl: fixture.config.mcp.resourceUrl,
    })
    expect(result.posts).toEqual([{ postId: 'composed-draft' }])
    const otherRead = await rpc('tools/call', otherTokens.access_token, 'list_drafts')
    expect(
      Schema.decodeUnknownSync(ReadResult)(await otherRead.json()).result.structuredContent.posts,
    ).toEqual([{ postId: 'other-composed-draft' }])

    for (const actor of ['owner', 'other', 'reader']) {
      const connections = await handler.handler(
        new Request('https://editorial-test.localhost/api/user/mcp-connections', {
          headers: { authorization: `Bearer ${actor}-session-token` },
        }),
      )

      expect(connections.status).toBe(200)

      const body = Schema.decodeUnknownSync(
        Schema.Struct({ connections: Schema.Array(Schema.Struct({ clientId: Schema.String })) }),
      )(await connections.json())

      expect(body.connections.map((connection) => connection.clientId).toSorted()).toEqual(
        Match.value(actor).pipe(
          Match.when('reader', () => []),
          Match.when('owner', () => [clientId]),
          Match.orElse(() => [clientId, otherClientId].toSorted()),
        ),
      )
    }

    expect(
      (await rpc('tools/list', tokens.access_token, undefined, 'https://evil.example')).status,
    ).toBe(403)

    const metadata = await handler.handler(
      new Request('https://editorial-test.localhost/.well-known/oauth-protected-resource/mcp'),
    )

    expect(metadata.status).toBe(200)
    expect(await metadata.json()).toMatchObject({
      resource: fixture.config.mcp.resourceUrl,
      authorization_servers: [fixture.config.mcp.issuer],
    })

    const authorizationMetadata = await handler.handler(
      new Request('https://editorial-test.localhost/.well-known/oauth-authorization-server/auth'),
    )

    expect(authorizationMetadata.status).toBe(200)
    expect(await authorizationMetadata.json()).toMatchObject({
      issuer: fixture.config.mcp.issuer,
      authorization_endpoint: `${fixture.config.mcp.issuer}/oauth2/authorize`,
      token_endpoint: `${fixture.config.mcp.issuer}/oauth2/token`,
      registration_endpoint: `${fixture.config.mcp.issuer}/oauth2/register`,
    })

    const revoked = await handler.handler(
      new Request(
        `https://editorial-test.localhost/api/user/mcp-connections/${encodeURIComponent(clientId)}/revoke`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer owner-session-token',
            origin: fixture.config.urls.frontend,
          },
        },
      ),
    )

    expect(revoked.status).toBe(200)
    expect((await rpc('tools/list', tokens.access_token)).status).toBe(401)
    expect((await rpc('tools/list', otherTokens.access_token)).status).toBe(200)
  } finally {
    await handler.dispose()
  }
}, 15_000)

test('R3 public reads compose with persisted listener OAuth and legacy drafts without scope activation', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const clientId = await fixture.register('posts:read drafts:write content:read offline_access')

  // Knowing/registering the scope does not enable it on the production-default resource.
  const authorization = await fixture.request(
    `/oauth2/authorize?${fixture.authorizationQuery(clientId, 'content:read offline_access')}`,
    undefined,
    'reader',
  )

  expect(authorization.status).toBe(400)
  expect(await authorization.json()).toMatchObject({ error: 'invalid_scope' })
  expect(await fixture.db.select().from(oauthConsent)).toHaveLength(0)

  const Metadata = Schema.Struct({ scopes_supported: Schema.Array(Schema.String) })

  const metadataUrl = new URL(
    '/.well-known/oauth-protected-resource/mcp',
    fixture.config.mcp.resourceUrl,
  )

  const defaultHandler = createTestWebHandler(
    fixture.db.$client,
    undefined,
    undefined,
    undefined,
    Layer.succeed(ConfigService, fixture.config),
  )

  try {
    const metadata = await defaultHandler.handler(new Request(metadataUrl))
    expect(metadata.status).toBe(200)
    const scopes = Schema.decodeUnknownSync(Metadata)(await metadata.json()).scopes_supported
    expect(scopes).toEqual(['drafts:write', 'posts:read'])

    const fallback = await fixture.request(
      `/oauth2/authorize?${fixture.authorizationQuery(clientId, [...scopes, 'offline_access'].join(' '))}`,
      undefined,
      'owner',
    )

    expect(fallback.status).toBe(302)
    expect(new URL(fallback.headers.get('location') ?? '').pathname).toBe('/connect/gbfm/consent')
  } finally {
    await defaultHandler.dispose()
  }

  // Only this disposable D1 resource opts in; no production policy definition changes.
  await fixture.db.update(oauthResource).set({
    allowedScopes: JSON.stringify(['posts:read', 'drafts:write', 'content:read', 'offline_access']),
  })

  const tokens = async (actor: string, scope: string) =>
    Schema.decodeUnknownSync(OAuthTokens)(
      await (
        await fixture.exchange(clientId, await fixture.authorize(clientId, actor, scope))
      ).json(),
    )

  const listener = await tokens('reader', 'content:read offline_access')
  const editorial = await tokens('owner', 'posts:read drafts:write offline_access')
  const combined = await tokens('other', 'posts:read drafts:write content:read offline_access')

  await fixture.db.insert(postsTable).values([
    {
      id: 'r3-public',
      slug: 'r3-public',
      title: 'Public editorial',
      type: 'post',
      content: 'Public source',
    },
    {
      id: 'r3-private',
      slug: 'r3-private',
      title: 'SECRET POST',
      type: 'post',
      content: 'SECRET BODY',
      draft: true,
    },
  ])
  await fixture.db.insert(postCreators).values({ postId: 'r3-private', creatorId: 'reader' })
  await fixture.db.insert(showsTable).values([
    { id: 'r3-show', slug: 'r3-show', title: 'Public show', content: 'DO NOT RENDER' },
    {
      id: 'r3-hidden-show',
      slug: 'r3-hidden-show',
      title: 'SECRET SHOW',
      content: 'SECRET',
      draft: true,
    },
  ])
  await fixture.db.insert(audioTable).values([
    {
      id: 'r3-episode-a',
      slug: 'r3-episode-a',
      title: 'Older ID',
      type: 'mix',
      content: 'DO NOT RENDER',
      url: 'https://example.test/a.mp3',
      showId: 'r3-show',
      createdAt: new Date(1000),
    },
    {
      id: 'r3-episode-z',
      slug: 'r3-episode-z',
      title: 'Newer ID',
      type: 'track',
      content: 'DO NOT RENDER',
      url: 'https://example.test/z.mp3',
      showId: 'r3-show',
      createdAt: new Date(1000),
    },
    {
      id: 'r3-private-episode',
      slug: 'r3-private-episode',
      title: 'SECRET EPISODE',
      type: 'mix',
      content: 'SECRET BODY',
      url: 'https://example.test/private.mp3',
      showId: 'r3-show',
      draft: true,
      createdAt: new Date(3000),
    },
    {
      id: 'r3-hidden-parent',
      slug: 'r3-hidden-parent',
      title: 'SECRET PARENT CHILD',
      type: 'mix',
      content: 'SECRET BODY',
      url: 'https://example.test/parent.mp3',
      showId: 'r3-hidden-show',
    },
  ])

  // User and canonical artist identifiers deliberately collide across namespaces.
  await fixture.db.update(user).set({ username: 'r3-user' }).where(eq(user.id, 'reader'))
  await fixture.db.insert(musicArtistsTable).values({
    id: 'reader',
    name: 'Artist fallback',
    slug: 'r3-artist',
    publishedAt: new Date(1000),
  })
  await fixture.db.insert(audioArtists).values({ audioId: 'r3-episode-a', artistId: 'reader' })
  await fixture.db.insert(listeningCollectionsTable).values([
    { id: 'r3-collection', userId: 'reader', title: 'Public collection', published: true },
    { id: 'r3-private-collection', userId: 'reader', title: 'SECRET COLLECTION' },
  ])
  await fixture.db.insert(savedMixesTable).values([
    {
      id: 'r3-save',
      userId: 'reader',
      title: 'Public save',
      platform: 'soundcloud',
      url: 'https://soundcloud.com/disposable/mix',
      notes: 'Public notes',
      published: true,
    },
    {
      id: 'r3-private-save',
      userId: 'reader',
      title: 'SECRET SAVE',
      platform: 'soundcloud',
      url: 'https://soundcloud.com/disposable/private',
      notes: 'SECRET NOTES',
    },
    {
      id: 'r3-foreign-save',
      userId: 'other',
      title: 'SECRET FOREIGN',
      platform: 'soundcloud',
      url: 'https://soundcloud.com/disposable/foreign',
      published: true,
    },
  ])
  await fixture.db.insert(listeningMembershipsTable).values(
    ['r3-save', 'r3-private-save', 'r3-foreign-save'].map((mixId) => ({
      collectionId: 'r3-collection',
      mixId,
    })),
  )

  const domainSnapshot = async () =>
    Promise.all([
      fixture.db.select().from(postsTable),
      fixture.db.select().from(audioTable),
      fixture.db.select().from(musicArtistsTable),
      fixture.db.select().from(savedMixesTable),
      fixture.db.select().from(listeningCollectionsTable),
      fixture.db.select().from(listeningMembershipsTable),
    ])

  const beforeReads = await domainSnapshot()
  const providerRequests: Array<string> = []

  // The production route manifest, not an injected principal or test-only toolkit.
  const handler = createTestWebHandler(
    fixture.db.$client,
    undefined,
    undefined,
    undefined,
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
    undefined,
    Layer.succeed(ExternalMediaFetcher, async (url) => {
      providerRequests.push(url)

      return new Response('', { status: 404 })
    }),
  )

  const rpc = (token: typeof listener.access_token, name?: string, args: Schema.Json = {}) =>
    handler.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': name ? 'tools/call' : 'tools/list',
          'mcp-name': name ?? '',
          authorization: `Bearer ${Redacted.value(token)}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 91,
          method: name ? 'tools/call' : 'tools/list',
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

  const contentNames = [
    'list_published_posts',
    'get_show',
    'list_show_episodes',
    'search_catalogue',
    'get_mix',
    'get_public_profile',
    'get_public_collection',
  ]

  const newCalls = [
    ['search_catalogue', { query: 'ID', kind: 'audio' }],
    ['get_mix', { slug: 'r3-hidden-parent' }],
    ['get_public_profile', { username: 'r3-user' }],
    ['get_public_collection', { collectionId: 'r3-collection' }],
  ] as const

  const legacyNames = ['create_draft', 'update_draft', 'list_drafts', 'get_post']

  try {
    const enabledMetadata = await handler.handler(new Request(metadataUrl))
    expect(enabledMetadata.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Metadata)(await enabledMetadata.json()).scopes_supported,
    ).toEqual(['content:read', 'drafts:write', 'posts:read'])

    for (const [token, names] of [
      [listener.access_token, contentNames],
      [editorial.access_token, legacyNames],
      [combined.access_token, [...legacyNames, ...contentNames]],
    ] as const) {
      const response = await rpc(token)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(
        Schema.decodeUnknownSync(ToolList)(await response.json()).result.tools.map(
          ({ name }) => name,
        ),
      ).toEqual(names)
    }

    for (const [name, args] of [
      ...contentNames.slice(0, 3).map((name) => [name, { slug: 'r3-show' }] as const),
      ...newCalls,
    ]) {
      expect(await (await rpc(editorial.access_token, name, args)).json()).toMatchObject({
        result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
      })
    }

    expect(
      await (await rpc(listener.access_token, 'get_post', { postId: 'r3-private' })).json(),
    ).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
    })

    const posts = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: PublishedPostsResult }) }),
    )(await (await rpc(listener.access_token, 'list_published_posts')).json()).result
      .structuredContent

    expect(posts.posts.map(({ postId }) => postId)).toEqual(['r3-public'])
    const showResponse = await rpc(listener.access_token, 'get_show', { slug: 'r3-show' })
    expect(
      Schema.decodeUnknownSync(
        Schema.Struct({ result: Schema.Struct({ structuredContent: PublicShowResult }) }),
      )(await showResponse.json()).result.structuredContent.show,
    ).toMatchObject({
      showId: 'r3-show',
      reviewUrl: 'https://editorial-test.localhost/shows/r3-show',
    })

    for (const [offset, expected] of [
      [0, 'r3-episode-z'],
      [1, 'r3-episode-a'],
    ] as const) {
      const response = await rpc(listener.access_token, 'list_show_episodes', {
        slug: 'r3-show',
        limit: 1,
        offset,
      })

      const body = await response.text()
      expect(body).not.toMatch(/SECRET|\.mp3|DO NOT RENDER|createdById|playCount/)

      const page = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({ result: Schema.Struct({ structuredContent: ShowEpisodesResult }) }),
        ),
      )(body).result.structuredContent

      expect(page.episodes.map(({ audioId }) => audioId)).toEqual([expected])
      expect(page.pagination).toEqual({ total: 2, limit: 1, offset, hasMore: offset === 0 })
    }

    const search = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: PublicSearchResult }) }),
    )(await (await rpc(listener.access_token, 'search_catalogue', newCalls[0][1])).json())

    expect(search.result.structuredContent.results.map(({ id }) => id)).toEqual([
      'r3-episode-z',
      'r3-episode-a',
    ])
    expect(search.result.structuredContent.endpoint).toEqual(posts.endpoint)

    const mix = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: PublicMixResult }) }),
    )(await (await rpc(listener.access_token, 'get_mix', newCalls[1][1])).json())

    expect(mix.result.structuredContent.mix.audioId).toBe('r3-hidden-parent')
    expect(JSON.stringify(mix)).not.toMatch(/r3-hidden-show|showId|showSlug|SECRET BODY|\.mp3/)

    for (const [username, kind] of [
      ['r3-user', 'user'],
      ['r3-artist', 'artist'],
    ] as const) {
      const profile = Schema.decodeUnknownSync(
        Schema.Struct({ result: Schema.Struct({ structuredContent: PublicProfileResult }) }),
      )(await (await rpc(listener.access_token, 'get_public_profile', { username })).json())

      expect(profile.result.structuredContent.profile).toMatchObject({ id: 'reader', kind })
    }

    const collectionBody = await (
      await rpc(listener.access_token, 'get_public_collection', newCalls[3][1])
    ).text()

    expect(collectionBody).not.toMatch(/SECRET|r3-private-save|r3-foreign-save|embedUrl|userId/)

    const collection = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({ result: Schema.Struct({ structuredContent: PublicCollectionResult }) }),
      ),
    )(collectionBody).result.structuredContent

    expect(collection.mixes.map(({ id }) => id)).toEqual(['r3-save'])
    expect(collection.pagination).toEqual({ total: 1, limit: 20, offset: 0, hasMore: false })

    for (const collectionId of ['r3-private-collection', 'absent']) {
      expect(
        await (await rpc(listener.access_token, 'get_public_collection', { collectionId })).json(),
      ).toMatchObject({
        result: { isError: true, content: [{ text: expect.stringContaining('not_found') }] },
      })
    }

    for (const name of ['get_show', 'list_show_episodes']) {
      const hidden = await (
        await rpc(listener.access_token, name, { slug: 'r3-hidden-show' })
      ).json()

      expect(hidden).toEqual(
        await (await rpc(listener.access_token, name, { slug: 'absent' })).json(),
      )
      expect(hidden).toMatchObject({
        result: { isError: true, content: [{ text: expect.stringContaining('not_found') }] },
      })
    }

    expect(await domainSnapshot()).toEqual(beforeReads)
    expect(providerRequests).toEqual([])

    const Saved = Schema.Struct({ result: Schema.Struct({ structuredContent: GetPostResult }) })

    const draft = Schema.decodeUnknownSync(Saved)(
      await (
        await rpc(combined.access_token, 'create_draft', {
          requestId: crypto.randomUUID(),
          title: 'Combined R3 draft',
          content: 'Private combined body',
        })
      ).json(),
    ).result.structuredContent

    expect(draft.post.content).toBe('Private combined body')
    expect(
      Schema.decodeUnknownSync(Saved)(
        await (await rpc(combined.access_token, 'get_post', { postId: draft.post.postId })).json(),
      ).result.structuredContent,
    ).toEqual(draft)
    expect(
      await (await rpc(combined.access_token, 'get_show', { slug: 'r3-show' })).json(),
    ).toMatchObject({ result: { structuredContent: { show: { showId: 'r3-show' } } } })
    expect(
      await (await rpc(listener.access_token, 'get_post', { postId: draft.post.postId })).json(),
    ).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
    })
    await fixture.db.update(user).set({ banned: true }).where(eq(user.id, 'reader'))
    expect((await rpc(listener.access_token, 'get_show', { slug: 'r3-show' })).status).toBe(401)

    for (const [name, args] of newCalls) {
      expect((await rpc(listener.access_token, name, args)).status).toBe(401)
    }

    await fixture.db.update(user).set({ banned: false }).where(eq(user.id, 'reader'))
    expect((await rpc(listener.access_token, 'get_show', { slug: 'r3-show' })).status).toBe(200)
    await Effect.runPromise(
      fixture.service.disconnect(Schema.decodeUnknownSync(UserId)('reader'), clientId),
    )
    expect((await rpc(listener.access_token, 'get_show', { slug: 'r3-show' })).status).toBe(401)

    for (const [name, args] of newCalls) {
      expect((await rpc(listener.access_token, name, args)).status).toBe(401)
    }

    // Metadata follows live resource policy, including null (unrestricted) and
    // the existing drafts:write admission/downscoping exception.
    for (const [allowedScopes, expected] of [
      [JSON.stringify(['posts:read', 'offline_access']), ['drafts:write', 'posts:read']],
      [null, ['content:read', 'drafts:write', 'posts:read']],
    ] as const) {
      await fixture.db.update(oauthResource).set({ allowedScopes })

      for (const path of [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
      ]) {
        const metadata = await handler.handler(new Request(new URL(path, metadataUrl)))
        expect(metadata.status).toBe(200)
        expect(metadata.headers.get('cache-control')).toBe('private, no-store')
        expect(Schema.decodeUnknownSync(Metadata)(await metadata.json()).scopes_supported).toEqual(
          expected,
        )
      }
    }

    for (const policy of [
      { allowedScopes: 'not-json', disabled: false },
      { allowedScopes: JSON.stringify(['unsupported:scope']), disabled: false },
      { allowedScopes: null, disabled: true },
    ]) {
      await fixture.db.update(oauthResource).set(policy)
      const metadata = await handler.handler(new Request(metadataUrl))
      expect(metadata.status).toBe(503)
      expect(metadata.headers.get('cache-control')).toBe('private, no-store')
      expect(await metadata.text()).toBe('')
    }

    await fixture.db.delete(oauthResource)
    expect((await handler.handler(new Request(metadataUrl))).status).toBe(503)
  } finally {
    await handler.dispose()
  }
}, 30_000)

test('independent catalogue module composes with live OAuth and owned draft services', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const clientId = await fixture.register('posts:read drafts:write catalogue:read offline_access')
  // Disposable resource only. Production policy and schema are untouched.
  await fixture.db.update(oauthResource).set({
    allowedScopes: JSON.stringify([
      'posts:read',
      'drafts:write',
      'catalogue:read',
      'offline_access',
    ]),
  })
  await fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'other'))

  for (const [id, publishedAt] of [
    ['artist-null', null],
    ['artist-future', new Date('2099-01-01')],
  ] as const) {
    await fixture.db
      .insert(musicArtistsTable)
      .values({ id, name: id, slug: id, publishedAt, createdById: 'owner' })
  }

  const tokens = async (actor: string, scope: string) =>
    Schema.decodeUnknownSync(OAuthTokens)(
      await (
        await fixture.exchange(clientId, await fixture.authorize(clientId, actor, scope))
      ).json(),
    )

  const listener = await tokens('reader', 'catalogue:read offline_access')
  const owner = await tokens('owner', 'posts:read drafts:write catalogue:read offline_access')
  const admin = await tokens('other', 'posts:read offline_access')
  const handler = createComposedMcpFixture(fixture)

  const rpc = (
    method: string,
    token: typeof owner.access_token,
    name?: string,
    args: Schema.Json = {},
    accept = 'application/json, text/event-stream',
  ) =>
    handler.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept,
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': method,
          'mcp-name': name ?? '',
          authorization: `Bearer ${Redacted.value(token)}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 71,
          method,
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

  const Saved = Schema.Struct({ result: Schema.Struct({ structuredContent: GetPostResult }) })

  try {
    expect(
      Schema.decodeUnknownSync(ToolList)(
        await (await rpc('tools/list', listener.access_token)).json(),
      ).result.tools,
    ).toEqual([{ name: 'fixture_catalogue_artist' }])

    const streamListing = await rpc(
      'tools/list',
      listener.access_token,
      undefined,
      {},
      'text/event-stream',
    )

    // The installed request-scoped transport requires both accepted media types.
    expect(streamListing.status).toBe(406)
    const listedOwner = await (await rpc('tools/list', owner.access_token)).json()
    expect(
      Schema.decodeUnknownSync(ToolList)(listedOwner).result.tools.map((tool) => tool.name),
    ).toEqual([
      'create_draft',
      'update_draft',
      'list_drafts',
      'get_post',
      'fixture_catalogue_artist',
    ])
    expect(listedOwner).toMatchObject({
      jsonrpc: '2.0',
      id: 71,
      result: {
        tools: [
          expect.objectContaining({
            inputSchema: expect.any(Object),
            outputSchema: expect.any(Object),
          }),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
        ],
      },
    })

    for (const id of ['artist-null', 'artist-future']) {
      expect(
        await (
          await rpc('tools/call', listener.access_token, 'fixture_catalogue_artist', { id })
        ).json(),
      ).toMatchObject({ result: { structuredContent: { artist: { id, name: id, slug: id } } } })

      const text = await (
        await rpc('tools/call', listener.access_token, 'fixture_catalogue_artist', { id })
      ).text()

      expect(text).not.toContain('createdById')
    }

    expect(
      await (
        await rpc('tools/call', admin.access_token, 'fixture_catalogue_artist', {
          id: 'artist-null',
        })
      ).json(),
    ).toMatchObject({ result: { isError: true } })
    expect(
      await (
        await rpc('tools/call', owner.access_token, 'fixture_declared_permission', {
          nonce: 'declared-scope-dispatch-probe',
        })
      ).json(),
    ).toMatchObject({
      jsonrpc: '2.0',
      id: 71,
      result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
    })
    expect(
      await (
        await handler.handler(
          new Request('https://editorial-test.localhost/mcp', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${Redacted.value(owner.access_token)}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              'mcp-protocol-version': '2026-07-28',
              'mcp-method': 'tools/call',
              'mcp-name': 'fixture_declared_permission',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'tools/call',
              params: {
                name: 'fixture_declared_permission',
                arguments: { nonce: 'id-less-dispatch-probe' },
                _meta: {
                  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                  'io.modelcontextprotocol/clientCapabilities': {},
                },
              },
            }),
          }),
        )
      ).json(),
    ).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
    })
    expect(
      await (await rpc('tools/call', owner.access_token, 'fixture_unknown_tool')).json(),
    ).toMatchObject({ jsonrpc: '2.0', id: 71, error: { code: -32602 } })
    // Cached/guessed wire names never grant editorial access.
    expect(
      await (
        await rpc('tools/call', listener.access_token, 'get_post', { postId: 'private-guess' })
      ).json(),
    ).toMatchObject({ result: { isError: true } })

    const input = {
      requestId: crypto.randomUUID(),
      title: 'Composed draft',
      content: 'Owned private body',
    }

    const created = await Promise.all([
      rpc('tools/call', owner.access_token, 'create_draft', input),
      rpc('tools/call', owner.access_token, 'create_draft', input),
    ])

    const first = Schema.decodeUnknownSync(Saved)(await created[0].json()).result.structuredContent
    expect(
      Schema.decodeUnknownSync(Saved)(await created[1].json()).result.structuredContent,
    ).toEqual(first)
    expect(
      await fixture.db.select().from(postsTable).where(eq(postsTable.title, input.title)),
    ).toHaveLength(1)
    expect(
      await (
        await rpc('tools/call', owner.access_token, 'create_draft', {
          ...input,
          title: 'Changed retry',
        })
      ).json(),
    ).toMatchObject({ result: { isError: true } })
    expect(
      Schema.decodeUnknownSync(Saved)(
        await (
          await rpc('tools/call', owner.access_token, 'get_post', { postId: first.post.postId })
        ).json(),
      ).result.structuredContent,
    ).toEqual(first)

    const privateRead = await (
      await rpc('tools/call', admin.access_token, 'get_post', { postId: first.post.postId })
    ).json()

    const absentRead = await (
      await rpc('tools/call', admin.access_token, 'get_post', { postId: 'absent-id' })
    ).json()

    expect(privateRead).toEqual(absentRead)
    expect(privateRead).toMatchObject({ result: { isError: true } })

    const updates = await Promise.all(
      ['One', 'Two'].map((content) =>
        rpc('tools/call', owner.access_token, 'update_draft', {
          requestId: crypto.randomUUID(),
          postId: first.post.postId,
          expectedVersion: first.post.version,
          content,
        }),
      ),
    )

    const results = await Promise.all(updates.map((response) => response.json()))
    expect(
      results.filter(
        (result) =>
          Schema.decodeUnknownSync(
            Schema.Struct({ result: Schema.Struct({ isError: Schema.optional(Schema.Boolean) }) }),
          )(result).result.isError,
      ),
    ).toHaveLength(1)
    await fixture.db.update(user).set({ role: 'user' }).where(eq(user.id, 'owner'))
    expect((await rpc('tools/call', owner.access_token, 'create_draft', input)).status).toBe(401)
    // Downgrade must not disqualify an already-listener grant.
    expect((await rpc('tools/list', listener.access_token)).status).toBe(200)
    await fixture.db.update(user).set({ banned: true }).where(eq(user.id, 'reader'))
    expect((await rpc('tools/list', listener.access_token)).status).toBe(401)
    await fixture.db.update(user).set({ banned: false }).where(eq(user.id, 'reader'))
    await fixture.db
      .update(oauthClient)
      .set({ disabled: true })
      .where(eq(oauthClient.clientId, clientId))
    expect((await rpc('tools/list', listener.access_token)).status).toBe(401)
    await fixture.db
      .update(oauthClient)
      .set({ disabled: false })
      .where(eq(oauthClient.clientId, clientId))
    await fixture.db.update(oauthResource).set({ disabled: true })
    expect((await rpc('tools/list', listener.access_token)).status).toBe(401)
    await fixture.db.update(oauthResource).set({ disabled: false })
    await Effect.runPromise(fixture.service.disconnect(fixture.userId, clientId))
    expect((await rpc('tools/call', owner.access_token, 'create_draft', input)).status).toBe(401)
    await Effect.runPromise(
      fixture.service.disconnect(Schema.decodeUnknownSync(UserId)('reader'), clientId),
    )
    expect((await rpc('tools/list', listener.access_token)).status).toBe(401)
  } finally {
    await handler.dispose()
  }
}, 30_000)
