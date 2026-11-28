import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Option, Predicate } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { describe, expect, it } from 'vitest'

import { PageDocument } from '../domain/page'
import { PageQueryError } from './page-query'
import { AppRoute } from './route'
import {
  RoutedApplicationMessage,
  RoutedApplicationNoDeps,
  visiblePageDocument,
} from './routed-application'
import {
  activateRenderedReader,
  makeReaderLifetimeFixture,
  pumpReaderUntil,
  readerDocument,
  readerResponse,
  readerState,
  renderedResume,
  runReaderLifetime,
  type ReaderLifetimeRoot,
} from './routed-reader-lifetime.test-support'

const unavailable = 'This page is unavailable. Try again.'

const warning = 'Could not refresh this page. Showing the last loaded content.'

const visibleHeadings = (root: ReaderLifetimeRoot) =>
  root
    .all(Locator.tag('h1'))
    .filter((node) => {
      let current: ReturnType<ReaderLifetimeRoot['query']> = node

      while (current) {
        if (Predicate.isTagged(current, 'Element') && current.attrs.hidden !== undefined)
          return false
        current = current.parent
      }

      return true
    })
    .map(Locator.textOf)

const expectUnavailable = (root: ReaderLifetimeRoot) => {
  expect.soft(root.all(Locator.attr('role', 'alert')).map(Locator.textOf)).toContain(unavailable)
  expect.soft(root.head<{ title: string }>().title).toBe('Page unavailable | goosebumps.fm')
  expect(root.query(Locator.text(warning))).toBeUndefined()
  expect(root.get(Locator.text('Retry'))).toBeDefined()
}

describe('native Root entry resume transport presentation', () => {
  it('prefers the actual cached concrete destination over an entry-shell fallback after transport failure', () => {
    const cached = PageDocument.make({ ...readerDocument('/tweet/a'), principalKnown: true })
    const entry = PageDocument.make({ ...readerDocument('/tweets'), principalKnown: true })

    const failed = AsyncResult.fail(
      new PageQueryError({ reason: 'transport', status: 0, requestId: null, location: null }),
      { previousSuccess: Option.some(AsyncResult.success(cached)) },
    )

    expect(
      visiblePageDocument(
        failed,
        new URL(cached.url),
        { known: true, principalId: null, epoch: 1 },
        { page: entry, realm: 'first', currentRealm: 'first' },
      ),
    ).toBe(cached)
  })

  it.each(
    ['/tweets', '/tweet'].flatMap((entry) =>
      ['network', 'server'].map((failure) => ({ entry, failure })),
    ),
  )(
    '$entry concrete resume $failure failure shows the exact unavailable alert and head',
    async ({ entry, failure }) => {
      const fixture = makeReaderLifetimeFixture(entry, 'a')
      const held = Promise.withResolvers<Response>()
      fixture.pages.set('/tweet/a', [held.promise])

      await runReaderLifetime(
        fixture,
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          expect(renderedResume(root, entry)).toBe('/tweet/a')
          const title = root.head<{ title: string }>().title
          yield* router.navigate('/tweet/a')
          yield* pumpReaderUntil(() => fixture.pageRequests.includes('/tweet/a'))
          expect(root.model()?.pending).toBe(true)
          expect(visibleHeadings(root)).toContain('Tweets')
          expect(root.head<{ title: string }>().title).toBe(title)
          expect(fixture.writes).toEqual([])
          expect(fixture.apiRequests).toEqual([])
          expect(activateRenderedReader(root, '/tweet/a')).toBe(false)

          if (failure === 'network') held.reject(new Error('Disposable resume transport failure'))
          else held.resolve(readerResponse('/tweet/a', 503))
          yield* TestHost.settle
          expect(root.model()?.pending).toBe(false)
          expectUnavailable(root)
          expect(visibleHeadings(root)).not.toContain('Tweets')
          expect(readerState(root).props.active).toBe(false)
          expect(root.get(Locator.attr('data-reader-status', 'error'))).toMatchObject({
            attrs: {
              'data-reader-destination': new URL('/tweet/a', fixture.props.url).href,
              'data-reader-request': String(root.model()?.navigationId),
            },
          })
          expect(fixture.storage.get('anonymous')).toBe('a')
          expect(fixture.writes).toEqual([])
          expect(fixture.apiRequests).toEqual([])
          expect(fixture.pageRequests.filter((path) => path === '/tweet/a')).toHaveLength(1)
        }),
      )
    },
  )

  it.each(['success', 'failure'])(
    'resume retry targets the concrete URL and rejects stale %s before a current visible commit',
    async (outcome) => {
      const fixture = makeReaderLifetimeFixture('/tweets', 'a')
      const old = Promise.withResolvers<Response>()
      const current = Promise.withResolvers<Response>()
      fixture.pages.set('/tweet/a', [
        new Error('Initial resume failed'),
        old.promise,
        current.promise,
      ])

      await runReaderLifetime(
        fixture,
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          yield* router.navigate('/tweet/a')
          yield* TestHost.settle
          expectUnavailable(root)
          Locator.fire(root.get(Locator.text('Retry')), 'click')
          yield* pumpReaderUntil(
            () => fixture.pageRequests.filter((path) => path === '/tweet/a').length === 2,
          )
          expect(root.model()?.pending).toBe(true)
          const model = root.model()

          if (!model) throw new Error('Missing routed Root model')
          expect(AppRoute.print(model.route)).toBe('/tweet/a')
          expect(fixture.pageRequests.filter((path) => path === '/tweets')).toHaveLength(2)
          expect(fixture.writes).toEqual([])
          expect(fixture.apiRequests).toEqual([])
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* pumpReaderUntil(
            () => fixture.pageRequests.filter((path) => path === '/tweet/a').length === 3,
          )
          const navigationId = root.model()?.navigationId

          if (outcome === 'success') old.resolve(readerResponse('/tweet/a'))
          else old.reject(new Error('Superseded resume retry failed'))
          yield* TestHost.settle
          expect(root.model()?.pending).toBe(true)
          expect(root.model()?.navigationId).toBe(navigationId)
          expect(activateRenderedReader(root, '/tweet/a')).toBe(false)
          expect(fixture.writes).toEqual([])
          expect(fixture.apiRequests).toEqual([])
          expect(fixture.storage.get('anonymous')).toBe('a')
          current.resolve(readerResponse('/tweet/a'))
          yield* TestHost.settle
          expect(root.model()?.pending).toBe(false)
          expect(root.query(Locator.text(unavailable))).toBeUndefined()
          expect(fixture.writes).toEqual([])
          expect(fixture.apiRequests).toEqual([])
          expect(activateRenderedReader(root, '/tweet/a')).toBe(true)
          yield* TestHost.settle
          expect(fixture.storage.get('anonymous')).toBe('a')
          expect(fixture.writes).toEqual([{ identity: 'anonymous', slug: 'a' }])
          expect(fixture.apiRequests.filter((path) => path.endsWith('/seen'))).toEqual([
            'POST /api/content/posts/micro/a/seen',
          ])
          expect(fixture.apiRequests.filter((path) => path.endsWith('/neighbours'))).toEqual([
            'GET /api/content/posts/micro/a/neighbours',
          ])
          expect(fixture.apiRequests.filter((path) => path.endsWith('/screen/replies'))).toEqual([
            'GET /api/content/posts/micro/a/screen/replies',
          ])
          expect(activateRenderedReader(root, '/tweet/a')).toBe(true)
          yield* TestHost.settle
          expect(fixture.writes).toHaveLength(1)
          expect(fixture.apiRequests.filter((path) => path.endsWith('/seen'))).toHaveLength(1)
        }),
      )
    },
  )

  it.each([
    { source: '/tweets', target: '/tweets' },
    { source: '/about', target: '/privacy' },
    { source: '/tweet/a', target: '/tweet/a' },
    { source: '/tweets?q=ambient', target: '/tweet/a' },
  ])(
    'retains the accepted public source on $source to $target failure',
    async ({ source, target }) => {
      const fixture = makeReaderLifetimeFixture(source, 'a')
      const held = Promise.withResolvers<Response>()

      await runReaderLifetime(
        fixture,
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          const title = root.head<{ title: string }>().title
          const headings = visibleHeadings(root)
          fixture.pages.set(target, [held.promise])

          if (source === target) root.send(RoutedApplicationMessage.ClickedRetryPage())
          else yield* router.navigate(target)
          yield* pumpReaderUntil(() => root.model()?.pending === true)
          held.reject(new Error('Retain approved public source'))
          yield* TestHost.settle
          expect(root.model()?.pending).toBe(false)
          expect(root.text()).toContain(warning)
          expect(root.query(Locator.text(unavailable))).toBeUndefined()
          expect(root.head<{ title: string }>().title).toBe(title)
          expect(visibleHeadings(root)).toEqual(headings)
          expect(fixture.writes).toEqual([])
          expect(fixture.apiRequests).toEqual([])
        }),
      )
    },
  )

  it('keeps cached anonymous public return content and head through a failed revalidation', async () => {
    const fixture = makeReaderLifetimeFixture('/about')
    const held = Promise.withResolvers<Response>()

    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        const title = root.head<{ title: string }>().title
        const headings = visibleHeadings(root)
        yield* router.navigate('/privacy')
        yield* TestHost.settle
        fixture.pages.set('/about', [held.promise])
        yield* router.navigate('/about')
        yield* TestHost.settle
        expect(root.head<{ title: string }>().title).toBe(title)
        expect(visibleHeadings(root)).toEqual(headings)
        root.send(RoutedApplicationMessage.ClickedRetryPage())
        yield* pumpReaderUntil(
          () => fixture.pageRequests.filter((path) => path === '/about').length === 2,
        )
        expect(root.head<{ title: string }>().title).toBe(title)
        expect(visibleHeadings(root)).toEqual(headings)
        held.reject(new Error('Cached anonymous return revalidation failed'))
        yield* TestHost.settle
        expect(root.head<{ title: string }>().title).toBe(title)
        expect(visibleHeadings(root)).toEqual(headings)
        expect(root.text()).toContain(warning)
      }),
    )
  })

  it('never retains personalized entry content or head into failed concrete navigation', async () => {
    const fixture = makeReaderLifetimeFixture('/tweets')
    const principal = { id: 'owner-a', name: 'Owner A', username: 'owner-a', role: 'admin' }
    fixture.pages.set('/tweets', [
      Response.json({
        ...readerDocument('/tweets'),
        principal,
        principalKnown: true,
        title: 'Private entry marker',
        metadata: null,
      }),
    ])
    const held = Promise.withResolvers<Response>()
    fixture.pages.set('/tweet/a', [held.promise])

    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const router = yield* Router.Router

        const root = yield* TestHost.mount(RoutedApplicationNoDeps, {
          ...fixture.props,
          identity: { principalId: 'owner-a', known: true, epoch: 0 },
        })

        yield* TestHost.settle
        yield* router.navigate('/tweet/a')
        yield* pumpReaderUntil(() => fixture.pageRequests.includes('/tweet/a'))
        expect(visibleHeadings(root)).not.toContain('Tweets')
        expect(root.head<{ title: string }>().title).not.toContain('Private entry marker')
        held.reject(new Error('Private destination failed'))
        yield* TestHost.settle
        expectUnavailable(root)
        expect(root.model()?.retainedPublicPath).toBeNull()
        expect(root.head<{ title: string }>().title).not.toContain('Private entry marker')
        expect(fixture.writes).toEqual([])
        expect(fixture.apiRequests).toEqual([])
      }),
    )
  })
})
