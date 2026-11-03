import { Cause, Effect, Exit } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { HttpApiError } from 'effect/http-api'
import { expect, test } from 'vitest'

import type { ReaderConnection } from '@/api/tweetReader'

import { readerAction } from './readerAction'
import { readerOwnership } from './readerOwnership'
import { initialReaderState, ReaderEvent } from './readerState'

const fixture = () => {
  const owner = readerOwnership()
  const visit = owner.focus()

  const action = owner.beginAction({
    ...initialReaderState,
    request: visit.request,
    status: 'ready',
  })

  if (!action) throw new Error('expected an action')
  const events: Array<ReaderEvent> = []
  const targets: Array<string | null> = []
  const paths: Array<string> = []
  const started = Promise.withResolvers<AbortSignal>()

  const run = (
    kind: 'random' | 'reset',
    response: Response | Promise<Response>,
    cancelOnBlur = true,
  ) => {
    const connection: ReaderConnection = {
      baseUrl: 'https://fixture.test',
      sessionToken: null,
      httpClient: HttpClient.make((request, url, signal) => {
        paths.push(`${request.method} ${url.pathname}`)
        started.resolve(signal)

        return Effect.promise(() => Promise.resolve(response)).pipe(
          Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
        )
      }),
    }

    return Effect.runPromiseExit(
      readerAction(Effect.succeed(connection), {
        ...action,
        kind,
        current: 'current',
        acceptsResult: owner.acceptsResult,
        dispatch: (event) => events.push(event),
        go: (target) => targets.push(target),
      }),
      { signal: cancelOnBlur ? action.controller.signal : undefined },
    )
  }

  return { owner, visit, action, events, targets, paths, started: started.promise, run }
}

test.each(['random', 'reset'] as const)(
  'failed %s retains the visit and reports a notice',
  async (kind) => {
    const f = fixture()
    await f.run(kind, Response.json({}, { status: 500 }))
    expect(f.targets).toEqual([])
    expect(f.events).toEqual([
      ReaderEvent.Notice({ request: 1, message: "Couldn't update reading options. Try again." }),
    ])
    expect(f.owner.acceptsResult(f.action.request, f.action.controller)).toBe(true)
  },
)

test('random exhaustion is distinct from resetting to latest', async () => {
  const random = fixture()
  await random.run('random', Response.json(new HttpApiError.NotFound(), { status: 404 }))
  expect(random.targets).toEqual([])
  expect(random.events).toEqual([
    ReaderEvent.Notice({ request: 1, message: 'No other unread tweets remaining.' }),
  ])
  const reset = fixture()
  await reset.run('reset', Response.json({ reset: true }))
  expect(reset.targets).toEqual([null])
  expect(reset.events).toEqual([])
})

test('stale successful random results cannot navigate after blur and refocus', async () => {
  const f = fixture()
  const response = Promise.withResolvers<Response>()
  const running = f.run('random', response.promise, false)
  await f.started
  f.owner.blur(f.visit.controller)
  f.owner.focus()
  response.resolve(Response.json({ slug: 'another' }))
  expect(Exit.isSuccess(await running)).toBe(true)
  expect(f.targets).toEqual([])
  expect(f.events).toEqual([])
  expect(f.paths).toEqual(['GET /api/content/posts/micro/current/random'])
})

test.each(['random', 'reset'] as const)('blur cancels pending %s HTTP work', async (kind) => {
  const f = fixture()
  const response = Promise.withResolvers<Response>()
  const running = f.run(kind, response.promise)
  const signal = await f.started
  expect(signal.aborted).toBe(false)
  f.owner.blur(f.visit.controller)
  f.owner.focus()
  response.resolve(Response.json(kind === 'random' ? { slug: 'another' } : { reset: true }))
  const exit = await running
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
  expect(signal.aborted).toBe(true)
  expect(f.targets).toEqual([])
  expect(f.events).toEqual([])
})

test('an active successful random action navigates to the unread slug', async () => {
  const f = fixture()
  await f.run('random', Response.json({ slug: 'another' }))
  expect(f.targets).toEqual(['another'])
  expect(f.events).toEqual([])
  expect(f.paths).toEqual(['GET /api/content/posts/micro/current/random'])
})
