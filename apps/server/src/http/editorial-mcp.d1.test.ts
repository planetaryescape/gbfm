import { eq } from 'drizzle-orm'
import { Effect, Layer, Match, Redacted, Schema } from 'effect'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { GetPostResult } from '@/mcp/contracts'
import { ConfigService, createConfig } from '@/services/config.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { createTestWebHandler } from '@/test/http-handler'

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

  const call = (name: string, args: Schema.Json, token = writeTokens.access_token) =>
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

    const maximum = await call('create_draft', maximumInput)
    expect(maximum.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Saved)(await maximum.json()).result.structuredContent.post.content,
    ).toBe(maximumInput.content)
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
})

test('composed API serves connection instructions without OAuth while MCP stays protected', async () => {
  await using fixture = await createEditorialOAuthFixture()

  const handler = createTestWebHandler(
    fixture.db.$client,
    undefined,
    undefined,
    undefined,
    Layer.succeed(ConfigService, fixture.config),
  )

  try {
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
      { name: 'create_draft' },
      { name: 'update_draft' },
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
})
