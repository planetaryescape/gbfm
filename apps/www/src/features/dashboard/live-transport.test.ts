import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { describe, expect, it } from 'vitest'

import { runWithLayer } from '../player/testing'
import { emptyDocument } from './document'
import { DashboardService, DashboardServiceLive } from './service'

describe('native dashboard live HTTP adapter boundary', () => {
  it('uses each owning runtime scoped Fetch reference rather than a module-evaluation global', async () => {
    const calls: Array<string> = []

    const adapter =
      (owner: string): typeof fetch =>
      async (input, init) => {
        const request = new Request(input, init)
        calls.push(`${owner}:${new URL(request.url).pathname}`)
        expect(request.credentials).toBe('include')

        return Response.json({ success: true, favorites: [], total: 0 })
      }

    for (const owner of ['first-request', 'second-request']) {
      const layer = DashboardServiceLive.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, adapter(owner))),
      )

      const document = await runWithLayer(
        layer,
        Effect.gen(function* () {
          const service = yield* DashboardService

          return yield* service.request({ path: '/api/favorites' })
        }),
      )

      expect(document).toEqual(emptyDocument)
    }

    expect(calls).toEqual(['first-request:/api/favorites', 'second-request:/api/favorites'])
  })
})
