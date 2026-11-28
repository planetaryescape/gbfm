import { assert, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'

import { UploadTransport, UploadTransportLive } from './transport'

it.effect(
  'uses the same request-owned fetch reference and caller cancellation for upload transport',
  () =>
    Effect.gen(function* () {
      const controller = new AbortController()

      const calls: Array<{
        readonly path: string
        readonly signal: AbortSignal | null | undefined
      }> = []

      const ownedFetch: typeof globalThis.fetch = async (input, init) => {
        calls.push({
          path: input instanceof Request ? input.url : input.toString(),
          signal: init?.signal,
        })

        return new Response(null, { status: 204 })
      }

      const context = yield* Layer.build(
        UploadTransportLive.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, ownedFetch))),
      )

      const transport = Context.get(context, UploadTransport)

      const response = yield* Effect.tryPromise({
        try: () => transport.fetch('/api/upload/status', { signal: controller.signal }),
        catch: () => 'The request-owned transport failed.',
      })

      assert.equal(response.status, 204)
      assert.equal(calls.at(0)?.path, '/api/upload/status')
      assert.equal(calls.at(0)?.signal, controller.signal)
    }),
)
