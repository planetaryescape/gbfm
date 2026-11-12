import { Effect, Layer, Redacted, Schema } from 'effect'
import { McpServer, Tool, Toolkit } from 'effect/ai'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { DatabaseLayer } from '@/db/layer'
import { AuthLive } from '@/lib/auth'
import { MdxServiceLayer } from '@/lib/mdx'
import { McpPermission } from '@/mcp/authorization'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuth, EditorialOAuthUnavailable } from '@/services/editorial-oauth.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { RecordingEmailTransportLayer } from '@/services/email-transport.service'
import { PostServiceLayer } from '@/services/post.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'

import { makeMcpRoutes } from './editorial-mcp.routes'

const PrivateResultToolkit = Toolkit.make(
  Tool.make('fixture_private_result', {
    parameters: Schema.Struct({ progress: Schema.Boolean }),
    success: Schema.Struct({ privateResult: Schema.String }),
  })
    .annotate(McpPermission, { scopes: ['posts:read'] })
    .addDependency(McpServer.McpServer),
)

for (const format of ['json', 'sse']) {
  test(`post-execution OAuth unavailability suppresses a buffered private ${format} result`, async () => {
    await using fixture = await createEditorialOAuthFixture()
    const clientId = await fixture.register()

    const tokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
    )

    const state = {
      failAfterExecution: false,
      unavailable: false,
      executions: 0,
      suppressedVerifications: 0,
    }

    const privateResult = 'Disposable private tool result that must never escape on failure'

    const handlers = PrivateResultToolkit.toLayer({
      fixture_private_result: ({ progress }) =>
        Effect.gen(function* () {
          if (progress) {
            const server = yield* McpServer.McpServer

            yield* server.notifications['notifications/progress']({
              progressToken: 'private-result-progress',
              progress: 1,
              total: 1,
              message: privateResult,
            })
          }

          state.executions++
          state.unavailable = state.failAfterExecution

          return { privateResult }
        }),
    })

    const oauth = Layer.succeed(EditorialOAuth, {
      ...fixture.service,
      verify: (credential) =>
        Effect.suspend(() => {
          if (!state.unavailable) return fixture.service.verify(credential)
          state.suppressedVerifications++

          return Effect.fail(new EditorialOAuthUnavailable())
        }),
    })

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
    ).pipe(Layer.provideMerge(DatabaseLayer(fixture.database)))

    const email = EmailDeliveryLive.pipe(
      Layer.provide(RecordingEmailTransportLayer),
      Layer.provide(base),
    )

    const services = Layer.mergeAll(
      base,
      oauth,
      PostServiceLayer.pipe(Layer.provide(base)),
      AuthLive.pipe(Layer.provide(email), Layer.provide(base)),
    )

    const handler = HttpRouter.toWebHandler(
      makeMcpRoutes(PrivateResultToolkit, handlers).pipe(
        Layer.provide(services),
        Layer.provide(HttpServer.layerServices),
      ),
      { disableLogger: true },
    )

    const call = () =>
      handler.handler(
        new Request(fixture.config.mcp.resourceUrl, {
          method: 'POST',
          headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/call',
            'mcp-name': 'fixture_private_result',
            authorization: `Bearer ${Redacted.value(tokens.access_token)}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'fixture_private_result',
              arguments: { progress: format === 'sse' },
              _meta: {
                progressToken: 'private-result-progress',
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        }),
      )

    try {
      const baseline = await call()
      expect(baseline.status).toBe(200)
      expect(baseline.headers.get('content-type')).toContain(
        format === 'sse' ? 'text/event-stream' : 'application/json',
      )
      const baselineBody = await baseline.text()
      expect(baselineBody).toContain(privateResult)
      expect(baselineBody.includes('notifications/progress')).toBe(format === 'sse')
      expect(state.executions).toBe(1)

      state.failAfterExecution = true
      const denied = await call()
      expect(state.executions).toBe(2)
      expect(state.suppressedVerifications).toBe(1)
      expect(denied.status).toBe(503)
      expect(denied.headers.get('cache-control')).toBe('private, no-store')
      expect(denied.headers.get('www-authenticate')).toBeNull()
      expect(await denied.text()).toBe('')
    } finally {
      await handler.dispose()
    }
  }, 30_000)
}
