import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { screen } from '../features/reader/fixtures.test-support'
import { RoutedApplicationNoDeps } from './routed-application'
import {
  activateRenderedReader,
  makeReaderLifetimeFixture,
  pumpReaderUntil,
  readerResponse,
  readerState,
  renderedResume,
  runReaderLifetime,
} from './routed-reader-lifetime.test-support'

describe('native routed reader lifetime', () => {
  it('rejects a delayed checkpoint resolution after leaving and reentering the entry', async () => {
    const fixture = makeReaderLifetimeFixture('/tweets')
    const first = Promise.withResolvers<string | null>()
    fixture.reads.push(first.promise)

    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* pumpReaderUntil(() => fixture.checkpointReads.length === 1)
        yield* router.navigate('/about')
        yield* pumpReaderUntil(
          () => readerState(root).props.active === false && !root.model()?.pending,
        )
        expect(fixture.writes).toEqual([])
        expect(fixture.pageRequests).not.toContain('/tweet/stale')
        expect(readerState(root).model.resumeSlug).toBeNull()

        fixture.storage.set('anonymous', 'fresh')
        yield* router.navigate('/tweets')
        yield* pumpReaderUntil(() => renderedResume(root, '/tweets') === '/tweet/fresh')
        first.resolve('stale')
        yield* TestHost.settle
        expect(renderedResume(root, '/tweets')).toBe('/tweet/fresh')
        expect(fixture.pageRequests).not.toContain('/tweet/stale')
      }),
    )
  })

  it.each([
    ['auto-resume missing', true, 404, false, 1],
    ['auto-resume server failure', true, 503, false, 0],
    ['auto-resume transport failure', true, 200, true, 0],
    ['direct missing', false, 404, false, 0],
  ])(
    'clears only missing auto-resume once: %s',
    async (_name, resume, status, transport, clears) => {
      const fixture = makeReaderLifetimeFixture('/tweets', 'a')
      fixture.pages.set('/tweet/a', [
        transport ? new Error('Disposable transport failure') : readerResponse('/tweet/a', status),
      ])
      await runReaderLifetime(
        fixture,
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          expect(renderedResume(root, '/tweets')).toBe('/tweet/a')

          if (!resume) {
            yield* router.navigate('/about')
            yield* TestHost.settle
          }

          yield* router.navigate('/tweet/a')
          yield* TestHost.settle
          expect(activateRenderedReader(root, '/tweet/a')).toBe(false)
          yield* TestHost.settle
          expect(fixture.writes.filter(({ slug }) => slug === null)).toHaveLength(clears)
          expect(fixture.storage.get('anonymous')).toBe(clears ? null : 'a')
          expect(fixture.apiRequests.filter((path) => path.endsWith('/seen'))).toEqual([])

          if (clears === 1) {
            yield* router.navigate('/about')
            yield* TestHost.settle
            yield* router.navigate('/tweet/a')
          }

          yield* TestHost.settle
          expect(fixture.writes.filter(({ slug }) => slug === null)).toHaveLength(clears)
        }),
      )
    },
  )

  it('does not commit mismatched reader documents across fresh concrete navigations', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/a')
    fixture.pages.set('/tweet/b', [readerResponse('/tweet/a'), readerResponse('/tweet/a')])
    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(activateRenderedReader(root, '/tweet/a')).toBe(true)
        yield* TestHost.settle
        expect(fixture.storage.get('anonymous')).toBe('a')
        yield* router.navigate('/about')
        yield* TestHost.settle
        yield* router.navigate('/tweet/b')
        yield* TestHost.settle
        expect(activateRenderedReader(root, '/tweet/b')).toBe(false)
        const requests = fixture.pageRequests.filter((path) => path === '/tweet/b').length
        expect(requests).toBe(1)
        const writes = fixture.writes.length
        yield* router.navigate('/about')
        yield* TestHost.settle
        yield* router.navigate('/tweet/b')
        yield* TestHost.settle
        expect(activateRenderedReader(root, '/tweet/b')).toBe(false)
        expect(fixture.pageRequests.filter((path) => path === '/tweet/b')).toHaveLength(2)
        expect(fixture.writes).toHaveLength(writes)
        expect(fixture.apiRequests).not.toContain('POST /api/content/posts/micro/b/seen')
        expect(fixture.writes.some(({ slug }) => slug === 'b')).toBe(false)
      }),
    )
  })

  it.each(['/tweet/a', '/tweets/a'])(
    'does not advance the anonymous identity epoch for query-only changes on %s',
    async (path) => {
      const fixture = makeReaderLifetimeFixture(path)
      await runReaderLifetime(
        fixture,
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          const identity = root.model()?.identity
          expect(identity).toEqual({ known: true, principalId: null, epoch: 0 })
          yield* router.navigate(`${path}?at=2024-04&layout=compact`)
          yield* TestHost.settle
          expect(root.model()?.identity).toEqual(identity)
        }),
      )
    },
  )

  it('revalidates an auto-resume target rather than committing its cached successful document', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/a')
    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(activateRenderedReader(root, '/tweet/a')).toBe(true)
        yield* TestHost.settle
        yield* router.navigate('/tweets')
        yield* TestHost.settle
        expect(renderedResume(root, '/tweets')).toBe('/tweet/a')
        fixture.pages.set('/tweet/a', [readerResponse('/tweet/a', 404)])
        yield* router.navigate('/tweet/a')
        yield* TestHost.settle
        expect(fixture.pageRequests.filter((path) => path === '/tweet/a')).toHaveLength(2)
        expect(activateRenderedReader(root, '/tweet/a')).toBe(false)
        expect(fixture.writes.filter(({ slug }) => slug === null)).toHaveLength(1)
        expect(fixture.storage.get('anonymous')).toBeNull()
      }),
    )
  })

  it('keeps current replies after leaving and returning to the same slug', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/a')
    const oldReplies = Promise.withResolvers<Response>()
    fixture.replies.push(oldReplies.promise, Response.json([screen('fresh-reply').post]))
    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(activateRenderedReader(root, '/tweet/a')).toBe(true)
        yield* pumpReaderUntil(() =>
          fixture.apiRequests.some((path) => path.endsWith('/screen/replies')),
        )
        yield* router.navigate('/about')
        yield* pumpReaderUntil(
          () => readerState(root).props.active === false && !root.model()?.pending,
        )
        yield* router.navigate('/tweet/a')
        yield* pumpReaderUntil(
          () => readerState(root).props.active === true && !root.model()?.pending,
        )
        expect(readerState(root).props.navigationId).toBe(root.model()?.navigationId)
        expect(readerState(root).model.navigationId).toBe(root.model()?.navigationId)
        expect(activateRenderedReader(root, '/tweet/a')).toBe(true)
        yield* pumpReaderUntil(
          () => fixture.apiRequests.filter((path) => path.endsWith('/screen/replies')).length === 2,
        )
        oldReplies.resolve(Response.json([screen('stale-reply').post]))
        yield* TestHost.settle
        expect(root.query(Locator.attr('href', '/tweet/fresh-reply'))).toBeDefined()
        expect(root.query(Locator.attr('href', '/tweet/stale-reply'))).toBeUndefined()
        expect(fixture.apiRequests.filter((path) => path.endsWith('/seen'))).toHaveLength(1)
        expect(fixture.storage.get('anonymous')).toBe('a')
      }),
    )
  })
})
