import { eq } from 'drizzle-orm'
import { Layer, Redacted, Schema } from 'effect'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { ConfigService } from '@/services/config.service'
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

test('composed HTTP MCP requires OAuth on discovery and calls and disconnects immediately', async () => {
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

  const clientId = await fixture.register()

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
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
  } finally {
    await handler.dispose()
  }
})
