import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  ReportNavigation,
  RoutedApplicationMessage,
  RoutedApplicationNoDeps,
} from './routed-application'
import {
  makeReaderLifetimeFixture,
  pumpReaderUntil,
  readerDocument,
  readerResponse,
  runReaderLifetime,
} from './routed-reader-lifetime.test-support'

describe('retirement: actual Root navigation ordering and reader telemetry', () => {
  it.each(['success', 'failure'])(
    'retains the visible public page during cold loads and after current failure despite stale %s',
    async (outcome) => {
      const fixture = makeReaderLifetimeFixture('/about')
      const first = Promise.withResolvers<Response>()
      const current = Promise.withResolvers<Response>()
      fixture.pages.set('/mixes', [first.promise])
      fixture.pages.set('/editorial', [current.promise])
      await runReaderLifetime(
        fixture,
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          const heading = Locator.textOf(root.get(Locator.tag('h1')))
          const title = root.head<{ title: string }>().title

          const visibleHeading = () => {
            const node = root.query(Locator.tag('h1'))

            return node ? Locator.textOf(node) : null
          }

          yield* router.navigate('/mixes')
          yield* pumpReaderUntil(() => fixture.pageRequests.includes('/mixes'))
          expect.soft(visibleHeading()).toBe(heading)
          expect.soft(root.head<{ title: string }>().title).toBe(title)
          yield* router.navigate('/editorial')
          yield* pumpReaderUntil(() => fixture.pageRequests.includes('/editorial'))
          const id = root.model()?.navigationId

          if (outcome === 'success') first.resolve(readerResponse('/mixes'))
          else first.reject(new Error('Superseded cold load'))
          yield* TestHost.settle
          expect(root.model()?.navigationId).toBe(id)
          expect(root.model()?.pending).toBe(true)
          current.reject(new Error('Current cold load failed'))
          yield* TestHost.settle
          expect(root.model()?.pending).toBe(false)
          expect.soft(visibleHeading()).toBe(heading)
          expect.soft(root.head<{ title: string }>().title).toBe(title)
        }),
      )
    },
  )

  it.each([
    { start: '/about', outcome: 'success' },
    { start: '/about', outcome: 'failure' },
    { start: '/tweet/origin', outcome: 'success' },
    { start: '/tweet/origin', outcome: 'failure' },
  ])(
    'keeps a newer reader request loading across stale $outcome from $start',
    async ({ start, outcome }) => {
      const fixture = makeReaderLifetimeFixture(start)
      const first = Promise.withResolvers<Response>()
      const second = Promise.withResolvers<Response>()
      fixture.pages.set('/tweet/first', [first.promise])
      fixture.pages.set('/tweet/second', [second.promise])
      const reports: Array<string> = []
      const outcomes: Array<string | undefined> = []

      const layer = Layer.merge(
        fixture.layer,
        ReportNavigation.toLayer(({ phase, outcome }) =>
          Effect.sync(() => {
            reports.push(phase)

            if (phase === 'completed') outcomes.push(outcome)
          }),
        ),
      )

      await runReaderLifetime(
        { layer },
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          yield* router.navigate('/tweet/first')
          yield* pumpReaderUntil(() => fixture.pageRequests.includes('/tweet/first'))
          yield* router.navigate('/tweet/second')
          yield* pumpReaderUntil(() => fixture.pageRequests.includes('/tweet/second'))
          const navigationId = root.model()?.navigationId
          expect(root.model()?.pending).toBe(true)

          if (start === '/tweet/origin')
            expect(root.get(Locator.attr('data-reader-status', 'loading'))).toMatchObject({
              attrs: { 'data-reader-request': String(navigationId) },
            })
          expect(root.text()).not.toContain('Tweet first')

          if (outcome === 'success') first.resolve(readerResponse('/tweet/first'))
          else first.reject(new Error('Superseded transport failure'))
          yield* TestHost.settle
          expect(root.model()?.navigationId).toBe(navigationId)
          expect(root.model()?.pending).toBe(true)

          if (start === '/tweet/origin')
            expect(root.get(Locator.attr('data-reader-status', 'loading'))).toMatchObject({
              attrs: { 'data-reader-request': String(navigationId) },
            })
          expect(root.text()).not.toContain('Tweet first')
          expect(root.query(Locator.attr('data-reader-status', 'error'))).toBeUndefined()
          expect(reports).not.toContain('completed')
          second.resolve(readerResponse('/tweet/second'))
          yield* TestHost.settle
          expect(root.model()?.pending).toBe(false)
          expect(root.get(Locator.attr('data-reader-status', 'ready'))).toBeDefined()
          expect(root.text()).toContain('Tweet second')
          expect(reports.at(-1)).toBe('completed')
          expect(outcomes).toEqual(['succeeded'])
        }),
      )
    },
  )

  it.each(['missing', 'network'])(
    'distinguishes committed empty content from %s navigation error',
    async (outcome) => {
      const fixture = makeReaderLifetimeFixture('/about')
      fixture.pages.set('/tweet/missing', [
        outcome === 'missing'
          ? Response.json(
              { ...readerDocument('/tweet/missing', 404), failure: null },
              { status: 404 },
            )
          : new Error('Transport unavailable'),
      ])
      const outcomes: Array<string | undefined> = []

      const layer = Layer.merge(
        fixture.layer,
        ReportNavigation.toLayer(({ phase, outcome }) =>
          Effect.sync(() => {
            if (phase === 'completed') outcomes.push(outcome)
          }),
        ),
      )

      await runReaderLifetime(
        { layer },
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          yield* router.navigate('/tweet/missing')
          yield* TestHost.settle
          expect(root.model()?.pending).toBe(false)
          expect(outcomes).toEqual([outcome === 'missing' ? 'succeeded' : 'failed'])

          if (outcome === 'missing')
            expect(root.get(Locator.attr('data-reader-status', 'empty'))).toBeDefined()
          else {
            expect(root.text()).toContain('Showing the last loaded content.')
            expect(root.get(Locator.attr('data-reader-status', 'error'))).toBeDefined()
            expect(root.get(Locator.attr('data-reader-status', 'error'))).toMatchObject({
              attrs: {
                'data-reader-destination': new URL('/tweet/missing', fixture.props.url).href,
                'data-reader-request': String(root.model()?.navigationId),
              },
            })
            expect(root.query(Locator.attr('data-reader-status', 'empty'))).toBeUndefined()
          }
        }),
      )
    },
  )

  it('shows cached anonymous public content immediately while return revalidation remains pending', async () => {
    const fixture = makeReaderLifetimeFixture('/about')
    const pending = Promise.withResolvers<Response>()
    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        const title = root.head<{ title: string }>().title
        const text = root.text()
        yield* router.navigate('/privacy')
        yield* TestHost.settle
        fixture.pages.set('/about', [pending.promise])
        yield* router.navigate('/about')
        yield* TestHost.settle
        expect(root.text()).toContain(text)
        expect(root.head<{ title: string }>().title).toBe(title)
        root.send(RoutedApplicationMessage.ClickedRetryPage())
        yield* pumpReaderUntil(
          () => fixture.pageRequests.filter((path) => path === '/about').length === 2,
        )
        expect(root.text()).toContain(text)
        expect(root.head<{ title: string }>().title).toBe(title)
        pending.resolve(readerResponse('/about'))
        yield* TestHost.settle
      }),
    )
  })
})
