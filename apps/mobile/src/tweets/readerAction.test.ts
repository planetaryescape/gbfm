import { Effect } from 'effect'
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

  const run = (kind: 'random' | 'reset', response: Response) => {
    const connection: ReaderConnection = {
      baseUrl: 'https://fixture.test',
      sessionToken: null,
      httpClient: HttpClient.make((request, url) => {
        paths.push(`${request.method} ${url.pathname}`)

        return Effect.succeed(HttpClientResponse.fromWeb(request, response))
      }),
    }

    return Effect.runPromise(
      readerAction(Effect.succeed(connection), {
        ...action,
        kind,
        current: 'current',
        acceptsResult: owner.acceptsResult,
        dispatch: (event) => events.push(event),
        go: (target) => targets.push(target),
      }),
    )
  }

  return { owner, visit, action, events, targets, paths, run }
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
  f.owner.blur(f.visit.controller)
  f.owner.focus()
  await f.run('random', Response.json({ slug: 'another' }))
  expect(f.targets).toEqual([])
  expect(f.events).toEqual([])
  expect(f.paths).toEqual(['GET /api/content/posts/micro/current/random'])
})
