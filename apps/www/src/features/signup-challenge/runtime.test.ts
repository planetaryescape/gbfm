import { expect, it } from 'vitest'

import type { Status } from '../../domain/auth/challenge'
import { startSignupChallenge, type ChallengeWidget } from './runtime'

const fixture = () => {
  const statuses: Array<Status> = []
  const callbacks: Array<Parameters<ChallengeWidget['render']>[0]> = []
  const removed: Array<string> = []
  const requests: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = []
  const redirects: Array<string> = []
  const prepared: Array<string> = []

  const runtime = startSignupChallenge({
    sitekey: 'fixture-key',
    action: 'account-signup',
    status: (status) => {
      statuses.push(status)
    },
    widget: () => ({
      render: (options) => {
        callbacks.push(options)

        return 'widget'
      },
      reset: () => {},
      remove: (id) => {
        removed.push(id)
      },
    }),
    loadScript: () => () => {},
    prepare: (token, signal) => {
      prepared.push(token)

      return () =>
        new Promise<Response>((resolve) => {
          requests.push({ signal, resolve })
        })
    },
    redirect: (url) => {
      redirects.push(url)
    },
  })

  runtime.start()

  return { runtime, statuses, callbacks, removed, requests, redirects, prepared }
}

it('disposal aborts the form request and suppresses its late redirect and challenge callbacks', async () => {
  const f = fixture()
  f.callbacks[0]?.callback('fixture-token')
  const submission = f.runtime.submit()
  f.runtime.dispose()
  expect(f.requests[0]?.signal.aborted).toBe(true)
  f.callbacks[0]?.callback('stale-token')
  f.requests[0]?.resolve(new Response('', { status: 400 }))
  await submission
  expect(f.removed).toEqual(['widget'])
  expect(f.redirects).toEqual([])
  expect(f.statuses.at(-1)).toBe('submitting')
})

it('only one native form request uses a ready token, with no token in emitted status', async () => {
  const f = fixture()
  f.callbacks[0]?.callback('fixture-token')
  const submission = f.runtime.submit()
  await f.runtime.submit()
  expect(f.prepared).toEqual(['fixture-token'])
  expect(f.requests).toHaveLength(1)
  f.requests[0]?.resolve(new Response('', { status: 400 }))
  await submission
  expect(f.statuses).toEqual(['verifying', 'ready', 'submitting', 'failed'])
  expect(JSON.stringify(f.statuses)).not.toContain('fixture-token')
})

it('an expired token cannot submit until a new verification succeeds', async () => {
  const f = fixture()
  f.callbacks[0]?.callback('expired-fixture')
  f.callbacks[0]?.['expired-callback']()
  await f.runtime.submit()
  expect(f.requests).toEqual([])
  expect(f.statuses.at(-1)).toBe('failed')
  f.runtime.dispose()
})

it('a late failed submission cannot overwrite a fresh verification after retry', async () => {
  const f = fixture()
  f.callbacks[0]?.callback('first-fixture-token')
  const submission = f.runtime.submit()
  f.runtime.retry()
  f.callbacks[0]?.callback('second-fixture-token')
  f.requests[0]?.resolve(new Response('', { status: 400 }))
  await submission
  expect(f.statuses.at(-1)).toBe('ready')
  f.runtime.dispose()
})
