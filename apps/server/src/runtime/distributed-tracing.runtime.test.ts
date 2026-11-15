import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Option, Schema } from 'effect'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { applyD1Migrations } from '@/test/migrate-d1'

const event = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literal('transaction'),
      contexts: Schema.Struct({
        trace: Schema.Struct({
          trace_id: Schema.String,
          span_id: Schema.String,
          parent_span_id: Schema.optional(Schema.String),
        }),
      }),
      spans: Schema.optional(
        Schema.Array(
          Schema.Struct({
            span_id: Schema.String,
            parent_span_id: Schema.optional(Schema.String),
            trace_id: Schema.String,
            op: Schema.optional(Schema.String),
            description: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
)

let runtime: Miniflare

let directory: string

const envelopes: Array<string> = []

const exported = Promise.withResolvers<void>()

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gbfm-distributed-tracing-'))
  const scriptPath = join(directory, 'worker.mjs')
  execFileSync('bun', [
    'build',
    'src/test/distributed-tracing-worker.ts',
    '--target=browser',
    '--external=cloudflare:workers',
    '--external=node:*',
    '--outfile',
    scriptPath,
  ])
  runtime = new Miniflare({
    modulesRoot: directory,
    modules: [{ type: 'ESModule', path: scriptPath }],
    compatibilityDate: '2026-07-04',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'tracing-fixture' },
    serviceBindings: {
      CAPTURE: async (request) => {
        envelopes.push(await request.text())

        if (
          envelopes.some((body) => body.includes('"type":"transaction"')) &&
          envelopes.some((body) => body.includes('distributed tracing fixture'))
        )
          exported.resolve()

        return new Response('{}')
      },
    },
  })
  await applyD1Migrations(await runtime.getD1Database('DB'))
}, 20000)

afterAll(async () => {
  await runtime?.dispose()

  if (directory) await rm(directory, { recursive: true, force: true })
})

test('resolved staging bindings cannot enable the SDK through its environment fallback', async () => {
  const response = await runtime.dispatchFetch('https://api.goosebumps.fm/fixture/staging')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ sentryEnabled: false })
})

test('the real workerd API, Effect handler, D1 queries and warning log retain one incoming trace', async () => {
  const traceId = '33333333333333333333333333333333'
  const caller = '4444444444444444'

  const headers = new Headers({
    'sentry-trace': `${traceId}-${caller}-1`,
    b3: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-1',
    baggage: 'customer=synthetic-secret-do-not-export,sentry-sampled=true',
  })

  const response = await runtime.dispatchFetch(
    'https://api.goosebumps.fm/api/content/homepage-mixes',
    { headers: Object.fromEntries(headers) },
  )

  expect(response.status).toBe(200)
  expect(response.headers.get('x-fixture-b3-removed')).toBe('true')
  expect(response.headers.get('x-fixture-baggage')).not.toContain('synthetic-secret-do-not-export')
  await response.arrayBuffer()
  await exported.promise
  const sdkSpanId = response.headers.get('x-fixture-server-span')
  const payload = envelopes.join('\n')
  expect(payload).not.toContain('synthetic-secret-do-not-export')
  expect(payload).toContain('distributed tracing fixture')
  expect(payload).toContain(`"trace_id":"${traceId}"`)

  const events = envelopes.flatMap((body) =>
    body.split('\n').flatMap((line) => Option.toArray(event(line))),
  )

  const roots = events.map((entry) => entry.contexts.trace)
  const spans = events.flatMap((entry) => entry.spans ?? [])
  expect(
    roots.some(
      (root) =>
        root.span_id === sdkSpanId && root.parent_span_id === caller && root.trace_id === traceId,
    ),
  ).toBe(true)
  expect(spans.some((span) => span.parent_span_id === sdkSpanId && span.trace_id === traceId)).toBe(
    true,
  )
  expect(spans.some((span) => span.op?.startsWith('db') && span.trace_id === traceId)).toBe(true)
  const service = spans.find((span) => span.description === 'Tracing.read')
  const database = spans.find((span) => span.op?.startsWith('db'))
  expect(service).toBeDefined()
  expect(database?.parent_span_id).toBe(service?.span_id)
  expect([...roots, ...spans].every((span) => span.trace_id === traceId)).toBe(true)

  const logContainer = Schema.decodeUnknownOption(
    Schema.fromJsonString(
      Schema.Struct({
        items: Schema.Array(
          Schema.Struct({
            trace_id: Schema.String,
            body: Schema.String,
            attributes: Schema.Record(Schema.String, Schema.Unknown),
          }),
        ),
      }),
    ),
  )

  const logs = envelopes.flatMap((body) =>
    body
      .split('\n')
      .flatMap((line) =>
        Option.toArray(logContainer(line)).flatMap((container) => container.items),
      ),
  )

  const log = logs.find((entry) => entry.body === 'distributed tracing fixture')
  expect(log?.trace_id).toBe(traceId)

  const parent = Schema.decodeUnknownOption(
    Schema.Struct({ type: Schema.Literal('string'), value: Schema.String }),
  )(log?.attributes['sentry.trace.parent_span_id'])

  expect(Option.getOrUndefined(parent)?.value).toBe(service?.span_id)
})
