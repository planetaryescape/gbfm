import * as Sentry from '@sentry/cloudflare'
import { Context, Effect, Exit, Option, Predicate, Schema } from 'effect'
import { expect, test } from 'vitest'

import { workerSentryOptions } from './sentry-options'
import { createSentryTracer } from './sentry-tracer'

test('API release identity accepts only a complete deployment SHA', () => {
  const env = { SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/123', SENTRY_ENVIRONMENT: 'prod' }
  expect(workerSentryOptions({ ...env, APP_RELEASE: 'a'.repeat(40) }).release).toBe(
    `gbfm-api@${'a'.repeat(40)}`,
  )

  for (const APP_RELEASE of ['', 'local', 'abcdef', 'synthetic-secret-do-not-export'])
    expect(workerSentryOptions({ ...env, APP_RELEASE }).release).toBeUndefined()
})

test('real SDK export drops only MCP list-change notifications and retains tool execution parentage', async () => {
  const envelopes: Array<string> = []
  const pending: Array<Promise<unknown>> = []
  const release = `gbfm-api@${'a'.repeat(40)}`
  Sentry.setAsyncLocalStorageAsyncContextStrategy()

  const response = await Sentry.wrapRequestHandler(
    {
      request: new Request('https://fixture.test/mcp'),
      context: {
        waitUntil: (promise) => {
          pending.push(promise)
        },
        passThroughOnException: () => {},
      },
      options: {
        ...workerSentryOptions({
          SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/123',
          SENTRY_ENVIRONMENT: 'prod',
          APP_RELEASE: 'a'.repeat(40),
        }),
        tracesSampler: () => 1,
        defaultIntegrations: [],
        transport: (options) =>
          Sentry.createTransport(options, async (request) => {
            envelopes.push(
              Predicate.isString(request.body)
                ? request.body
                : new TextDecoder().decode(request.body),
            )

            return { statusCode: 200 }
          }),
      },
    },
    async () => {
      const tracer = createSentryTracer()
      const parent = Sentry.getActiveSpan()?.spanContext().spanId
      await Effect.runPromise(
        Effect.gen(function* () {
          for (const kind of ['tools', 'resources', 'prompts']) {
            yield* Effect.void.pipe(
              Effect.withSpan(`McpServer/Notifications.notifications/${kind}/list_changed`, {
                kind: 'client',
              }),
            )
          }

          yield* Effect.void.pipe(
            Effect.withSpan('McpServer/Notifications.notifications/progress', { kind: 'client' }),
          )
          yield* Effect.void.pipe(Effect.withSpan('EditorialRead.getPost'))
        }).pipe(Effect.withTracer(tracer)),
      )

      const root = tracer.span({
        name: 'McpServer/Notifications.notifications/tools/list_changed',
        parent: Option.none(),
        annotations: Context.empty(),
        links: [],
        kind: 'internal',
        startTime: BigInt(Date.now()) * 1_000_000n,
        sampled: true,
        root: false,
      })

      root.end(BigInt(Date.now()) * 1_000_000n, Exit.void)

      return Response.json({ parent })
    },
  )

  await Promise.all(pending)

  const result = Schema.decodeUnknownSync(Schema.Struct({ parent: Schema.String }))(
    await response.json(),
  )

  const transaction = Schema.decodeUnknownOption(
    Schema.fromJsonString(
      Schema.Struct({
        type: Schema.Literal('transaction'),
        spans: Schema.Array(
          Schema.Struct({
            description: Schema.String,
            parent_span_id: Schema.String,
          }),
        ),
      }),
    ),
  )

  const spans = envelopes.flatMap((body) =>
    body
      .split('\n')
      .flatMap((line) => Option.toArray(transaction(line)).flatMap((event) => event.spans)),
  )

  expect(spans.find((span) => span.description === 'EditorialRead.getPost')?.parent_span_id).toBe(
    result.parent,
  )
  const payload = envelopes.join('\n')
  expect(payload).toContain(release)
  expect(payload).toContain('EditorialRead.getPost')
  expect(payload).toContain('McpServer/Notifications.notifications/progress')
  expect(payload).not.toContain('notifications/resources/list_changed')
  expect(payload).not.toContain('notifications/prompts/list_changed')
  expect(payload.match(/notifications\/tools\/list_changed/g)).toHaveLength(1)
  expect(payload).not.toContain('synthetic-secret-do-not-export')
})
