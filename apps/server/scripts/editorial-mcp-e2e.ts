import { EditorialOAuthSettings, OAuthClientId } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Layer, Redacted, Schema } from 'effect'

import { user } from '@/db/auth.schema'
import { makeDatabaseClient } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { seedLocalUsers } from '@/db/seed-local-users'
import { ConfigService, createConfig } from '@/services/config.service'
import { createTestWebHandler } from '@/test/http-handler'
import { createMigratedD1Database } from '@/test/migrate-d1'

const frontend = process.env.FRONTEND_URL ?? 'https://mcp-479.localhost'

const resource = await createMigratedD1Database()

const db = makeDatabaseClient(resource.database)

await seedLocalUsers(db)

const owner = await db.select({ id: user.id }).from(user).where(eq(user.username, 'local-editor'))

const settings = Schema.decodeUnknownSync(EditorialOAuthSettings)({
  ownerUserId: owner[0]?.id,
  resourceUrl: `${frontend}/mcp`,
  issuer: `${frontend}/auth`,
})

await db.insert(postsTable).values({
  id: 'mcp-browser-draft',
  title: 'Listening notes: a disposable draft',
  slug: 'mcp-browser-draft',
  type: 'post',
  content: 'Disposable editorial content for local MCP verification.',
  draft: true,
})

await db
  .insert(postCreators)
  .values({ postId: 'mcp-browser-draft', creatorId: settings.ownerUserId })

const base = createConfig()

const app = createTestWebHandler(
  resource.database,
  undefined,
  undefined,
  undefined,
  Layer.succeed(ConfigService, {
    ...base,
    mcp: settings,
    urls: { ...base.urls, frontend },
    auth: {
      ...base.auth,
      betterAuthUrl: settings.issuer,
      betterAuthSecret: 'disposable-editorial-browser-test-secret-at-least-32-characters',
    },
  }),
)

const authorization = new Map<string, { clientId: typeof OAuthClientId.Type; verifier: string }>()

const request = (path: string, values: Record<string, Schema.Json>, form = false) =>
  app.handler(
    new Request(`${frontend}${path}`, {
      method: 'POST',
      headers: {
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        'cf-connecting-ip': '192.0.2.79',
      },
      body: form
        ? new URLSearchParams(
            Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(values),
          ).toString()
        : JSON.stringify(values),
    }),
  )

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 0),
  fetch: async (incoming) => {
    const url = new URL(incoming.url)
    const callback = `http://127.0.0.1:${server.port}/oauth-callback`

    if (url.pathname === '/api/e2e/mcp-start') {
      const registered = await request('/auth/oauth2/register', {
        client_name: 'Disposable editorial client',
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        redirect_uris: [callback],
      })

      const client = Schema.decodeUnknownSync(Schema.Struct({ client_id: OAuthClientId }))(
        await registered.json(),
      )

      const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))

      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '')

      const state = crypto.randomUUID()
      authorization.set(state, { clientId: client.client_id, verifier })

      const query = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: callback,
        response_type: 'code',
        scope: 'posts:read offline_access',
        resource: settings.resourceUrl,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      })

      return Response.redirect(`${settings.issuer}/oauth2/authorize?${query}`, 303)
    }

    if (url.pathname === '/oauth-callback') {
      const state = url.searchParams.get('state') ?? ''
      const pending = authorization.get(state)
      authorization.delete(state)

      if (!pending || !url.searchParams.get('code'))
        return new Response('Authorization was not completed.', { status: 400 })

      const exchanged = await request(
        '/auth/oauth2/token',
        {
          client_id: pending.clientId,
          grant_type: 'authorization_code',
          code: url.searchParams.get('code') ?? '',
          code_verifier: pending.verifier,
          redirect_uri: callback,
          resource: settings.resourceUrl,
        },
        true,
      )

      if (exchanged.status !== 200)
        return new Response('Token exchange failed.', { status: exchanged.status })

      const tokens = Schema.decodeUnknownSync(
        Schema.Struct({ access_token: Schema.RedactedFromValue(Schema.String) }),
      )(await exchanged.json())

      const discovered = await app.handler(
        new Request(settings.resourceUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${Redacted.value(tokens.access_token)}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/list',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        }),
      )

      const tools = Schema.decodeUnknownSync(
        Schema.Struct({
          result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
        }),
      )(await discovered.json())

      return new Response(
        `Connected to local GBFM. Read-only tools: ${tools.result.tools.map((tool) => tool.name).join(', ')}.`,
        { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } },
      )
    }

    return app.handler(incoming)
  },
})

process.stdout.write(`Disposable editorial MCP API: ${server.url}\n`)

const stop = async () => {
  await server.stop(true)
  await app.dispose()
  await resource.dispose()
  process.exit()
}

process.on('SIGINT', stop)

process.on('SIGTERM', stop)
