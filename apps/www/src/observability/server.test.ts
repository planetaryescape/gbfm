import * as Sentry from '@sentry/cloudflare'
import { Option, Predicate, Schema } from 'effect'
import { expect, test } from 'vitest'

import {
  instrumentWorker,
  logServerRequest,
  serverTraceMeta,
  serverTracingOptions,
  traceApiRequest,
} from './server'

const transaction = Schema.decodeUnknownOption(
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
        }),
      ),
    ),
  }),
)

test('the real Worker SDK continues the browser parent through API forwarding and request logs', async () => {
  const envelopes: Array<string> = []
  const pending: Array<Promise<unknown>> = []
  const forwarded: Array<Headers> = []
  const traceId = '11111111111111111111111111111111'
  const browserSpan = '2222222222222222'
  const secret = 'synthetic-secret-do-not-export'

  const context = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise)
    },
    passThroughOnException: () => {},
  }

  const options: Sentry.CloudflareOptions = {
    ...serverTracingOptions,
    enabled: true,
    dsn: 'https://abc123@o1.ingest.sentry.io/123',
    release: `gbfm-www@${'a'.repeat(40)}`,
    environment: 'development',
    transport: (options) =>
      Sentry.createTransport(options, (request) => {
        envelopes.push(
          Predicate.isString(request.body) ? request.body : new TextDecoder().decode(request.body),
        )

        return Promise.resolve({ statusCode: 200 })
      }),
  }

  const api = instrumentWorker(
    {
      fetch: async (request) => {
        forwarded.push(new Headers(request.headers))
        logServerRequest({
          service: 'www',
          requestId: 'fixture',
          route: '/tweets',
          method: 'GET',
          release: 'a'.repeat(40),
          status: 200,
          durationMs: 1,
        })

        return Response.json({ ok: true })
      },
    },
    options,
  )

  let meta = ''

  const www = instrumentWorker(
    {
      fetch: async (request) => {
        meta = serverTraceMeta()

        return traceApiRequest(
          new Request('https://api.internal/api/content/posts/micro', {
            headers: new Headers(request.headers),
          }),
          (outgoing) => Promise.resolve(api.fetch(outgoing, {}, context)),
        )
      },
    },
    options,
  )

  const response = await www.fetch(
    new Request(`https://goosebumps.fm/tweet/${secret}`, {
      headers: {
        'sentry-trace': `${traceId}-${browserSpan}-1`,
        baggage: `customer=${secret},sentry-transaction=${secret},sentry-sampled=true`,
        cookie: `session=${secret}`,
      },
    }),
    {},
    context,
  )

  expect(await response.json()).toEqual({ ok: true })
  await Promise.all(pending)
  await Sentry.flush(2000)
  const header = forwarded[0]?.get('sentry-trace')
  expect(header?.startsWith(`${traceId}-`)).toBe(true)
  expect(header).not.toBe(`${traceId}-${browserSpan}-1`)
  expect(forwarded[0]?.get('traceparent')).toBe(`00-${header?.slice(0, 49)}-01`)
  expect(forwarded[0]?.get('baggage')).not.toContain(secret)
  expect(meta).toContain(traceId)
  expect(meta).not.toContain(secret)

  const payload = envelopes.join('\n')
  expect(payload).not.toContain(secret)
  expect(payload).toContain('www.request.completed')
  expect(payload).toContain(`"trace_id":"${traceId}"`)

  const events = envelopes.flatMap((body) =>
    body.split('\n').flatMap((line) => {
      const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))(line)

      return Option.isSome(parsed) ? Option.toArray(transaction(parsed.value)) : []
    }),
  )

  expect(events.length).toBeGreaterThanOrEqual(2)
  const wwwEvent = events.find((event) => event.contexts.trace.parent_span_id === browserSpan)
  expect(wwwEvent).toBeDefined()

  const apiEvent = events.find(
    (event) => event.contexts.trace.parent_span_id === header?.split('-')[1],
  )

  expect(apiEvent).toBeDefined()
  expect(
    wwwEvent?.spans?.some(
      (span) =>
        span.span_id === apiEvent?.contexts.trace.parent_span_id &&
        span.parent_span_id === wwwEvent.contexts.trace.span_id,
    ),
  ).toBe(true)
})

test('overlapping requests keep SSR metadata and outgoing parents isolated', async () => {
  const firstEntered = Promise.withResolvers<void>()
  const secondEntered = Promise.withResolvers<void>()
  const pending: Array<Promise<unknown>> = []

  const context = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise)
    },
    passThroughOnException: () => {},
  }

  const options: Sentry.CloudflareOptions = {
    ...serverTracingOptions,
    enabled: true,
    dsn: 'https://abc123@o1.ingest.sentry.io/123',
    transport: (settings) => Sentry.createTransport(settings, async () => ({ statusCode: 200 })),
  }

  const worker = instrumentWorker(
    {
      fetch: async (request) => {
        if (request.headers.get('x-fixture') === 'first') {
          firstEntered.resolve()
          await secondEntered.promise
        } else {
          await firstEntered.promise
          secondEntered.resolve()
        }

        const meta = serverTraceMeta()

        return traceApiRequest(
          new Request('https://api.internal/fixture', request),
          async (outgoing) =>
            Response.json({
              meta,
              parent: outgoing.headers.get('sentry-trace'),
              body: await outgoing.text(),
            }),
        )
      },
    },
    options,
  )

  const result = Schema.decodeUnknownSync(
    Schema.Struct({ meta: Schema.String, parent: Schema.String, body: Schema.String }),
  )

  const responses = await Promise.all(
    ['1', '2'].map(async (digit, index) => {
      const response = await worker.fetch(
        new Request('https://goosebumps.fm/fixture', {
          method: 'POST',
          body: `fixture-${index}`,
          headers: {
            'sentry-trace': `${digit.repeat(32)}-${digit.repeat(16)}-1`,
            'x-fixture': index === 0 ? 'first' : 'second',
          },
        }),
        {},
        context,
      )

      return result(await response.json())
    }),
  )

  for (const [index, response] of responses.entries()) {
    const traceId = String(index + 1).repeat(32)
    expect(response.meta).toContain(traceId)
    expect(response.parent.startsWith(traceId)).toBe(true)
    expect(response.body).toBe(`fixture-${index}`)
  }

  await Promise.all(pending)
})

test('an unavailable telemetry transport does not replace the application response', async () => {
  const pending: Array<Promise<unknown>> = []

  const worker = instrumentWorker(
    { fetch: async () => new Response('ready') },
    {
      ...serverTracingOptions,
      enabled: true,
      dsn: 'https://abc123@o1.ingest.sentry.io/123',
      transport: (options) =>
        Sentry.createTransport(options, async () => {
          throw new Error('Fixture transport unavailable')
        }),
    },
  )

  const response = await worker.fetch(
    new Request('https://goosebumps.fm/fixture'),
    {},
    {
      waitUntil: (promise) => {
        pending.push(promise)
      },
      passThroughOnException: () => {},
    },
  )

  expect(await response.text()).toBe('ready')
  await Promise.allSettled(pending)
})
