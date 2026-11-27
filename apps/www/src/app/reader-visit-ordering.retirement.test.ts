import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Predicate } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { describe, expect, it } from 'vitest'

import { ReaderPageMessage } from '../features/reader/contracts'
import { neighbours } from '../features/reader/fixtures.test-support'
import { RoutedApplicationNoDeps } from './routed-application'
import {
  activateRenderedReader,
  makeReaderLifetimeFixture,
  pumpReaderUntil,
  readerState,
  runReaderLifetime,
} from './routed-reader-lifetime.test-support'

describe('retirement: mounted native Reader write and query ordering', () => {
  it.each(['success', 'failure'])(
    'same-destination refresh rejects superseded metadata %s and a recorded revisit never rewrites',
    async (outcome) => {
      const fixture = makeReaderLifetimeFixture('/tweet/b')
      const old = Promise.withResolvers<Response>()
      let reads = 0
      let writes = 0

      const authoritative = {
        ...neighbours,
        timeline: [{ month: '2025-07', total: 10, unread: 6, newestSlug: 'newest' }],
      }

      const api = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) => {
          if (url.pathname.endsWith('/seen')) writes++

          if (url.pathname.endsWith('/neighbours')) {
            reads++

            const response =
              reads === 1 ? old.promise : Promise.resolve(Response.json(authoritative))

            return Effect.promise(async () => HttpClientResponse.fromWeb(request, await response))
          }

          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(url.pathname.endsWith('/seen') ? { recorded: true } : []),
            ),
          )
        }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(fixture.props.url.origin))),
      )

      await runReaderLifetime(
        { layer: Layer.merge(fixture.layer, api) },
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          expect(activateRenderedReader(root, '/tweet/b')).toBe(true)
          yield* pumpReaderUntil(() => reads === 1)

          const control = root
            .all(Locator.attr('href', '/tweet/latest'))
            .find((node) => Predicate.isTagged(node, 'Element') && node.dispatch !== undefined)

          if (!control || !Predicate.isTagged(control, 'Element') || !control.dispatch)
            throw new Error('No actual Reader refresh control')
          control.dispatch(
            'retirement-refresh',
            () => ReaderPageMessage.ClickedRetryNavigation(),
            undefined,
          )
          yield* pumpReaderUntil(
            () => reads === 2 && readerState(root).model.lastTimeline[0]?.month === '2025-07',
          )
          const current = readerState(root).model
          old.resolve(
            outcome === 'success' ? Response.json(neighbours) : new Response(null, { status: 500 }),
          )
          yield* TestHost.settle
          expect(readerState(root).model).toEqual(current)
          expect(root.text()).not.toContain('Retry navigation')
          yield* router.navigate('/about')
          yield* TestHost.settle
          yield* router.navigate('/tweet/b')
          yield* TestHost.settle
          expect(activateRenderedReader(root, '/tweet/b')).toBe(true)
          yield* TestHost.settle
          expect(readerState(root).model.visits.b).toBe('recorded')
          expect(writes).toBe(1)
        }),
      )
    },
  )

  it('visible visit completes first: no metadata query or retry until the earlier write settles', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/b')
    const earlier = Promise.withResolvers<Response>()
    const visible = Promise.withResolvers<Response>()
    const requests: Array<string> = []

    const api = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request, url) => {
        requests.push(`${request.method} ${url.pathname}`)

        const response = url.pathname.endsWith('/seen')
          ? url.pathname.includes('/b/')
            ? earlier.promise
            : visible.promise
          : Promise.resolve(Response.json(url.pathname.endsWith('/neighbours') ? neighbours : []))

        return Effect.promise(async () => HttpClientResponse.fromWeb(request, await response))
      }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(fixture.props.url.origin))),
    )

    await runReaderLifetime(
      { layer: Layer.merge(fixture.layer, api) },
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(activateRenderedReader(root, '/tweet/b')).toBe(true)
        yield* pumpReaderUntil(() => requests.some((path) => path.includes('/b/seen')))
        yield* router.navigate('/tweet/a')
        yield* TestHost.settle
        expect(activateRenderedReader(root, '/tweet/a')).toBe(true)
        yield* pumpReaderUntil(() => requests.some((path) => path.includes('/a/seen')))
        visible.resolve(Response.json({ recorded: true }))
        yield* TestHost.settle
        expect(readerState(root).model.visits).toEqual({ b: 'pending', a: 'recorded' })
        expect(requests.filter((path) => path.endsWith('/neighbours'))).toEqual([])

        const control = root
          .all(Locator.attr('href', '/tweet/latest'))
          .find((node) => Predicate.isTagged(node, 'Element') && node.dispatch !== undefined)

        if (!control || !Predicate.isTagged(control, 'Element') || !control.dispatch)
          throw new Error('No live native Reader control')
        const before = readerState(root).model
        control.dispatch(
          'retirement-retry-navigation',
          () => ReaderPageMessage.ClickedRetryNavigation(),
          undefined,
        )
        yield* TestHost.settle
        expect(requests.filter((path) => path.endsWith('/neighbours'))).toEqual([])
        const afterRetry = readerState(root).model
        earlier.resolve(Response.json({ recorded: true }))
        yield* TestHost.settle
        expect(requests.filter((path) => path.endsWith('/neighbours'))).toEqual([
          'GET /api/content/posts/micro/a/neighbours',
        ])
        expect(readerState(root).model.visits).toEqual({ b: 'recorded', a: 'recorded' })
        expect(afterRetry).toEqual(before)
      }),
    )
  })

  it.each(['success', 'failure'])(
    'rejects a superseded actual metadata %s and retains the last timeline on next-load failure',
    async (outcome) => {
      const fixture = makeReaderLifetimeFixture('/tweet/b')
      const old = Promise.withResolvers<Response>()
      let reads = 0

      const fresh = {
        ...neighbours,
        timeline: [{ month: '2025-05', total: 9, unread: 4, newestSlug: 'fresh' }],
      }

      const api = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) => {
          if (url.pathname.endsWith('/neighbours')) {
            reads++

            const response =
              reads === 1
                ? old.promise
                : Promise.resolve(
                    reads === 2 ? Response.json(fresh) : new Response(null, { status: 500 }),
                  )

            return Effect.promise(async () => HttpClientResponse.fromWeb(request, await response))
          }

          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(url.pathname.endsWith('/seen') ? { recorded: true } : []),
            ),
          )
        }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(fixture.props.url.origin))),
      )

      await runReaderLifetime(
        { layer: Layer.merge(fixture.layer, api) },
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          expect(activateRenderedReader(root, '/tweet/b')).toBe(true)
          yield* pumpReaderUntil(() => reads === 1)
          yield* router.navigate('/tweet/a')
          yield* TestHost.settle
          expect(activateRenderedReader(root, '/tweet/a')).toBe(true)
          yield* pumpReaderUntil(
            () => reads === 2 && readerState(root).model.lastTimeline[0]?.month === '2025-05',
          )
          const before = readerState(root).model
          old.resolve(
            outcome === 'success' ? Response.json(neighbours) : new Response(null, { status: 500 }),
          )
          yield* TestHost.settle
          expect(readerState(root).model).toEqual(before)
          expect(root.query(Locator.attr('href', '/tweet/c'))).toBeDefined()
          yield* router.navigate('/tweet/d')
          yield* TestHost.settle
          expect(activateRenderedReader(root, '/tweet/d')).toBe(true)
          yield* TestHost.settle
          expect(reads).toBe(3)
          expect(readerState(root).model.lastTimeline).toEqual(fresh.timeline)
          expect(root.text()).not.toContain('Caught up')
          expect(root.text()).toContain('Retry navigation')
        }),
      )
    },
  )

  it.each(['success', 'failure'])(
    'rejects metadata %s begun before a retried seen write even after that write completes',
    async (outcome) => {
      const fixture = makeReaderLifetimeFixture('/tweet/b')
      const stale = Promise.withResolvers<Response>()
      const retried = Promise.withResolvers<Response>()
      let writes = 0
      let reads = 0

      const fresh = {
        ...neighbours,
        seen: true,
        timeline: [{ month: '2025-06', total: 7, unread: 2, newestSlug: 'authoritative' }],
      }

      const api = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) => {
          let response: Promise<Response>

          if (url.pathname.endsWith('/seen')) {
            writes++
            response =
              writes === 1 ? Promise.resolve(new Response(null, { status: 500 })) : retried.promise
          } else if (url.pathname.endsWith('/neighbours')) {
            reads++
            response = reads === 1 ? stale.promise : Promise.resolve(Response.json(fresh))
          } else response = Promise.resolve(Response.json([]))

          return Effect.promise(async () => HttpClientResponse.fromWeb(request, await response))
        }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(fixture.props.url.origin))),
      )

      await runReaderLifetime(
        { layer: Layer.merge(fixture.layer, api) },
        Effect.gen(function* () {
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          expect(activateRenderedReader(root, '/tweet/b')).toBe(true)
          yield* pumpReaderUntil(() => reads === 1 && readerState(root).model.visits.b === 'failed')
          Locator.fire(root.get(Locator.text('Retry saving history')), 'click')
          yield* pumpReaderUntil(() => writes === 2)
          expect(readerState(root).model.visits.b).toBe('pending')
          retried.resolve(Response.json({ recorded: true }))
          yield* pumpReaderUntil(
            () => reads === 2 && readerState(root).model.lastTimeline[0]?.month === '2025-06',
          )
          const recorded = readerState(root).model
          stale.resolve(
            outcome === 'success' ? Response.json(neighbours) : new Response(null, { status: 500 }),
          )
          yield* TestHost.settle
          expect(readerState(root).model).toEqual(recorded)
          expect(readerState(root).model.lastTimeline).toEqual(fresh.timeline)
          expect(writes).toBe(2)
          expect(reads).toBe(2)
        }),
      )
    },
  )
})
