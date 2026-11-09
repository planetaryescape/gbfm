import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vitest'

import { withTestLayer } from '@/test/effect'

import { inspectLinkHealth, LinkHealthEgress } from './health'

test('health validates every redirect before sending another HEAD, exact hosts only', async () => {
  for (const location of [
    'https://127.0.0.1/track/x',
    'https://[::1]/',
    'https://evil.test/',
    'http://open.spotify.com/artist/x',
    'https://open.spotify.com.evil.test/artist/x',
    'https://user:pass@open.spotify.com/artist/x',
    'https://open.spotify.com:444/artist/x',
  ]) {
    const requested: Array<string> = []

    const result = await Effect.runPromise(
      inspectLinkHealth('https://open.spotify.com/artist/abc').pipe(
        Effect.provideService(LinkHealthEgress, {
          head: async (url) => {
            requested.push(url)

            return { status: 302, location }
          },
        }),
      ),
    )

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'unsupported_destination',
      requests: 1,
    })
    expect(requested).toEqual(['https://open.spotify.com/artist/abc'])
  }
})

test('total deadline aborts an in-flight HEAD rather than allowing later redirects', async () => {
  let requestSignal: AbortSignal | undefined
  let requests = 0

  const result = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const fiber = yield* inspectLinkHealth('https://open.spotify.com/artist/abc').pipe(
          Effect.provideService(LinkHealthEgress, {
            head: (_url, signal) => {
              requests += 1
              requestSignal = signal

              return new Promise(() => {})
            },
          }),
          Effect.forkChild,
        )

        yield* TestClock.adjust('4 seconds')

        return yield* Fiber.join(fiber)
      }),
      TestClock.layer(),
    ),
  )

  expect(result).toMatchObject({ status: 'provider_unavailable', reason: 'timeout', requests: 1 })
  expect(requests).toBe(1)
  expect(requestSignal?.aborted).toBe(true)
})

test('at most two redirects, no successful status implies musical equivalence, provider errors stay uncertain', async () => {
  let count = 0

  const result = await Effect.runPromise(
    inspectLinkHealth('https://open.spotify.com/artist/abc').pipe(
      Effect.provideService(LinkHealthEgress, {
        head: async () => {
          count += 1

          return { status: 302, location: '/artist/abc' }
        },
      }),
    ),
  )

  expect(result).toMatchObject({ status: 'blocked', reason: 'redirect_limit', requests: 3 })
  expect(count).toBe(3)

  for (const [status, expected] of [
    [200, 'reachable'],
    [404, 'not_found'],
    [403, 'provider_unavailable'],
    [429, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ] as const) {
    const observed = await Effect.runPromise(
      inspectLinkHealth('https://www.deezer.com/artist/123').pipe(
        Effect.provideService(LinkHealthEgress, { head: async () => ({ status, location: null }) }),
      ),
    )

    expect(observed.status).toBe(expected)
    expect(observed).not.toHaveProperty('equivalent')
  }
})
