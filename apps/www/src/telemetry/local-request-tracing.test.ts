import { once } from 'node:events'
import { createServer } from 'node:http'

import { Schema } from 'effect'
import { expect, test } from 'vitest'

import { createLocalRequestTracing } from './local-request-tracing'

const Export = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({
      scopeSpans: Schema.Array(
        Schema.Struct({
          spans: Schema.Array(
            Schema.Struct({
              traceId: Schema.String,
              spanId: Schema.String,
              parentSpanId: Schema.optional(Schema.String),
              name: Schema.String,
              attributes: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.Json })),
            }),
          ),
        }),
      ),
    }),
  ),
})

test('OTLP exports isolated request spans, propagates context and excludes raw failures and URLs', async () => {
  const exports: Array<string> = []

  const collector = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      exports.push(body)
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })

  collector.listen(0, '127.0.0.1')
  await once(collector, 'listening')

  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(
    collector.address(),
  )

  const tracing = createLocalRequestTracing(`http://127.0.0.1:${address.port}/v1/traces`)

  try {
    const propagated = await Promise.all(
      ['first', 'second'].map(async (id) => {
        let context = ''
        await tracing.trace(
          new Request('http://www.local/spotify/callback?code=private-code', {
            headers: {
              'x-request-id': id,
              cookie: 'session_token=private-cookie',
              'sentry-trace': `${(id === 'first' ? '1' : '2').repeat(32)}-${'3'.repeat(16)}-1`,
              'x-b3-traceid': '4'.repeat(32),
              'x-b3-spanid': '5'.repeat(16),
              baggage: 'customer=private-baggage',
            },
          }),
          async (request) => {
            context = request.headers.get('traceparent') ?? ''
            expect(request.headers.get('sentry-trace')).toBe(context.slice(3, 52) + '-1')
            expect(request.headers.has('x-b3-traceid')).toBe(false)
            expect(request.headers.has('x-b3-spanid')).toBe(false)
            expect(request.headers.get('baggage')).not.toContain('private-baggage')

            return new Response(null, { status: id === 'first' ? 200 : 404 })
          },
        )

        return { id, context }
      }),
    )

    await expect(
      tracing.trace(new Request('http://www.local/tweet/private-slug'), async () => {
        throw new Error('private-failure')
      }),
    ).rejects.toThrow('WWW request failed')
    await tracing.dispose()

    const payload = exports.join('\n')

    for (const secret of ['private-code', 'private-cookie', 'private-failure', 'private-slug']) {
      expect(payload).not.toContain(secret)
    }

    const spans = exports.flatMap((body) =>
      Schema.decodeUnknownSync(Export)(JSON.parse(body)).resourceSpans.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      ),
    )

    expect(spans).toHaveLength(3)

    for (const { id, context } of propagated) {
      const span = spans.find((span) =>
        span.attributes.some(
          (attribute) =>
            attribute.key === 'gbfm.request_id' &&
            JSON.stringify(attribute.value) === JSON.stringify({ stringValue: id }),
        ),
      )

      expect(span).toBeDefined()
      expect(span?.traceId).toBe((id === 'first' ? '1' : '2').repeat(32))
      expect(span?.parentSpanId).toBe('3'.repeat(16))
      expect(context).toBe(`00-${span?.traceId}-${span?.spanId}-01`)
      expect(span?.attributes).toContainEqual({
        key: 'http.response.status_code',
        value: { intValue: id === 'first' ? 200 : 404 },
      })
    }

    expect(propagated[0]?.context).not.toBe(propagated[1]?.context)
  } finally {
    await tracing.dispose()
    await new Promise<void>((resolve, reject) =>
      collector.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
