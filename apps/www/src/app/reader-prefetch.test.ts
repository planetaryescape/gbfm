import { Router } from '@effect/ui'
import { HtmlServer } from '@effect/ui/html'
import { TestHost } from '@effect/ui/testing'
import { Effect, Layer, Option } from 'effect'
import { HttpClient } from 'effect/http'
import { AsyncResult } from 'effect/reactivity'
import { describe, expect, it } from 'vitest'

import { nativePlayerServerLayer } from '../features/player/provider'
import { neighbours, screen } from '../features/reader/fixtures.test-support'
import { browserPageLayer, GetPage } from './page-query'
import { AppRoute } from './route'
import {
  RoutedApplication,
  RoutedApplicationMessage,
  RoutedApplicationNoDeps,
} from './routed-application'
import {
  activateRenderedReader,
  makeReaderLifetimeFixture,
  pumpReaderUntil,
  readerDocument,
  readerResponse,
  readerState,
  runReaderLifetime,
} from './routed-reader-lifetime.test-support'

describe('routed Reader neighbour prefetch', () => {
  it('server-renders only the current document without neighbour reads or visits', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/b')
    fixture.pages.set('/tweet/b', [Response.json({ ...readerDocument('/tweet/b'), neighbours })])

    const rendered = await runReaderLifetime(
      {
        layer: Layer.mergeAll(
          browserPageLayer(fixture.props.url, fixture.props.realm, async (input) => {
            fixture.pageRequests.push(new URL(new Request(input).url).pathname)

            return Response.json({ ...readerDocument('/tweet/b'), neighbours })
          }),
          Router.static({ routes: AppRoute, url: '/tweet/b' }),
          nativePlayerServerLayer,
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die(new Error('Unexpected SSR API read'))),
          ),
        ),
      },
      HtmlServer.renderToHtml(RoutedApplication, fixture.props, { budget: '5 seconds' }),
    )

    expect(rendered.html).toContain('data-tweet-swipe="b"')
    expect(fixture.pageRequests).toEqual(['/tweet/b'])
    expect(fixture.apiRequests).toEqual([])
    expect(fixture.writes).toEqual([])
  })

  it('loads adjacent page documents without rendering or recording either neighbour as a visit', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/b')
    fixture.pages.set('/tweet/b', [Response.json({ ...readerDocument('/tweet/b'), neighbours })])

    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(fixture.pageRequests.toSorted()).toEqual(['/tweet/a', '/tweet/b', '/tweet/c'])
        expect(fixture.writes).toEqual([])
        expect(fixture.apiRequests).toEqual([])
        expect(readerState(root).props.screen?.post.slug).toBe('b')
        expect(readerState(root).model.current).toBeNull()

        const owned = {
          path: '/tweet/a',
          realm: fixture.props.realm,
          identity: fixture.props.identity,
        }

        expect(root.entry(GetPage, owned)).toBeDefined()
        expect(root.entry(GetPage, { ...owned, realm: 'another-realm' })).toBeUndefined()
        expect(
          root.entry(GetPage, {
            ...owned,
            identity: { ...owned.identity, epoch: 1 },
          }),
        ).toBeUndefined()

        expect(activateRenderedReader(root, '/tweet/b')).toBe(true)
        yield* TestHost.settle
        expect(fixture.writes).toEqual([{ identity: 'anonymous', slug: 'b' }])
        expect(fixture.apiRequests.filter((path) => path.endsWith('/seen'))).toEqual([
          'POST /api/content/posts/micro/b/seen',
        ])
        expect(fixture.pageRequests.toSorted()).toEqual(['/tweet/a', '/tweet/b', '/tweet/c'])
      }),
    )
  })

  it.each([
    { principalId: null, known: false, epoch: 3 },
    { principalId: 'owner-a', known: true, epoch: 4 },
  ])('does not prefetch for bootstrap identity $principalId/$known', async (identity) => {
    const fixture = makeReaderLifetimeFixture('/tweet/b')

    const principal =
      identity.principalId === null
        ? null
        : { id: identity.principalId, name: 'Owner A', username: 'owner-a', role: null }

    fixture.pages.set('/tweet/b', [
      Response.json({ ...readerDocument('/tweet/b'), neighbours, principal }),
    ])

    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        yield* TestHost.mount(RoutedApplicationNoDeps, { ...fixture.props, identity })
        yield* TestHost.settle
        expect(fixture.pageRequests).toEqual(['/tweet/b'])
        expect(fixture.writes).toEqual([])
        expect(fixture.apiRequests).toEqual([])
      }),
    )
  })

  it('rejects a different request realm before any document read', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/b')
    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        yield* TestHost.mount(RoutedApplicationNoDeps, { ...fixture.props, realm: 'other-realm' })
        yield* TestHost.settle
        expect(fixture.pageRequests).toEqual([])
        expect(fixture.writes).toEqual([])
        expect(fixture.apiRequests).toEqual([])
      }),
    )
  })

  it('rejects personalized neighbour responses without changing the current principal or fetching recursively', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/b')
    fixture.pages.set('/tweet/b', [Response.json({ ...readerDocument('/tweet/b'), neighbours })])
    fixture.pages.set('/tweet/a', [
      Response.json({
        ...readerDocument('/tweet/a'),
        principal: { id: 'other-owner', name: 'Other', username: 'other', role: null },
        neighbours: { ...neighbours, older: 'must-not-fetch' },
      }),
    ])

    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle

        const entry = root.entry(GetPage, {
          path: '/tweet/a',
          identity: fixture.props.identity,
          realm: fixture.props.realm,
        })

        expect(entry).toBeDefined()

        if (!entry) throw new Error('Missing neighbour query entry')

        expect(Option.getOrUndefined(AsyncResult.error(entry.stored))?.reason).toBe('identity')
        expect(root.model()?.identity).toEqual(fixture.props.identity)
        expect(readerState(root).props.screen?.post.slug).toBe('b')
        expect(fixture.pageRequests.toSorted()).toEqual(['/tweet/a', '/tweet/b', '/tweet/c'])
        expect(fixture.writes).toEqual([])
        expect(fixture.apiRequests).toEqual([])
      }),
    )
  })

  it.each([
    ['unknown principal', { principalKnown: false }],
    [
      'authenticated principal',
      {
        principal: { id: 'owner-a', name: 'Owner A', username: 'owner-a', role: null },
      },
    ],
    ['failed page', { failure: 'Unavailable' }],
    [
      'draft post',
      {
        tweet: {
          ...screen('b'),
          post: { ...screen('b').post, draft: true },
        },
      },
    ],
    ['foreign canonical origin', { url: 'https://foreign.example/tweet/b' }],
  ])('does not prefetch from %s documents', async (_name, patch) => {
    const fixture = makeReaderLifetimeFixture('/tweet/b')
    fixture.pages.set('/tweet/b', [
      Response.json({ ...readerDocument('/tweet/b'), neighbours, ...patch }),
    ])

    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(fixture.pageRequests.every((path) => path === '/tweet/b')).toBe(true)
        expect(fixture.apiRequests).toEqual([])
        expect(fixture.writes).toEqual([])
      }),
    )
  })

  it('deduplicates neighbours and rejects self, reserved and non-slug targets', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/b')
    const document = readerDocument('/tweet/b')

    const variants = [
      { older: 'c', newer: 'c' },
      { older: 'b', newer: 'latest' },
      { older: '//foreign.example', newer: '../private' },
    ]

    for (const targets of variants) {
      fixture.pages.set('/tweet/b', [
        Response.json({ ...document, neighbours: { ...neighbours, ...targets } }),
      ])
      await runReaderLifetime(
        fixture,
        Effect.gen(function* () {
          yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
        }),
      )
    }

    expect(fixture.pageRequests).toEqual(['/tweet/b', '/tweet/c', '/tweet/b', '/tweet/b'])
    expect(fixture.writes).toEqual([])
    expect(fixture.apiRequests).toEqual([])
  })

  it.each(['departure', 'authentication'])(
    'cancels neighbour reads on %s and ignores their late responses',
    async (transition) => {
      const fixture = makeReaderLifetimeFixture('/tweet/b')
      const late = Promise.withResolvers<Response>()
      const signals = new Map<string, AbortSignal>()

      const documents = browserPageLayer(fixture.props.url, fixture.props.realm, (input, init) => {
        const request = new Request(input, init)
        const path = new URL(request.url).pathname
        signals.set(path, request.signal)

        if (path === '/tweet/b')
          return Promise.resolve(Response.json({ ...readerDocument(path), neighbours }))

        if (path === '/tweet/a' || path === '/tweet/c') return late.promise

        return Promise.resolve(readerResponse(path))
      })

      await runReaderLifetime(
        { layer: Layer.merge(fixture.layer, documents) },
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* pumpReaderUntil(() => signals.has('/tweet/a') && signals.has('/tweet/c'))

          if (transition === 'departure') {
            yield* router.navigate('/about')
            yield* pumpReaderUntil(
              () => readerState(root).props.active === false && !root.model()?.pending,
            )
          } else {
            root.send(RoutedApplicationMessage.ChangedAuthentication())
            yield* pumpReaderUntil(
              () => root.model()?.identity.epoch === 1 && !root.model()?.pending,
            )
          }

          expect(signals.get('/tweet/a')?.aborted).toBe(true)
          expect(signals.get('/tweet/c')?.aborted).toBe(true)
          late.resolve(readerResponse('/tweet/a'))
          yield* TestHost.settle
          expect(readerState(root).model.current).toBeNull()
          expect(fixture.writes).toEqual([])
          expect(fixture.apiRequests).toEqual([])
        }),
      )
    },
  )

  it('revalidates a prefetched neighbour in the fresh navigation epoch before committing it', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/b')
    fixture.pages.set('/tweet/b', [Response.json({ ...readerDocument('/tweet/b'), neighbours })])
    fixture.pages.set('/tweet/a', [readerResponse('/tweet/a'), readerResponse('/tweet/a', 404)])

    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(fixture.pageRequests.filter((path) => path === '/tweet/a')).toHaveLength(1)
        expect(activateRenderedReader(root, '/tweet/b')).toBe(true)
        yield* TestHost.settle
        yield* router.navigate('/tweet/a')
        yield* TestHost.settle
        expect(root.model()?.identity.epoch).toBe(1)
        expect(fixture.pageRequests.filter((path) => path === '/tweet/a')).toHaveLength(2)
        expect(activateRenderedReader(root, '/tweet/a')).toBe(false)
        expect(fixture.storage.get('anonymous')).toBe('b')
        expect(fixture.apiRequests.filter((path) => path.endsWith('/seen'))).toEqual([
          'POST /api/content/posts/micro/b/seen',
        ])
      }),
    )
  })
})
