import { Component, MessageLog, Router } from '@effect/ui'
import { HtmlServer } from '@effect/ui/html'
import { TestGlobalEvents } from '@effect/ui/html/testing'
import { Locator, TestHost } from '@effect/ui/testing'
import { MicroPostScreenResponse } from '@gbfm/api/post'
import { QueueTrack } from '@gbfm/player'
import { makeStaticSiteMetadata } from '@gbfm/site-metadata'
import { Effect, Layer, Predicate, Schema, Stream } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { describe, expect, it } from 'vitest'

import { PageDocument } from '../domain/page'
import { NavigationMessage } from '../features/navigation/domain'
import { PerformPlayer } from '../features/player/commands'
import { initialSnapshot } from '../features/player/domain'
import { nativePlayerServerLayer } from '../features/player/provider'
import { PlayerSnapshotSource } from '../features/player/subscriptions'
import { LoadMembership, SaveMembership } from '../features/public-actions/commands'
import { MembershipMessage } from '../features/public-actions/domain'
import { ReaderPageMessage, ReaderPageModel } from '../features/reader/contracts'
import { screen } from '../features/reader/fixtures.test-support'
import { PerformSpotify, ReadSpotifyStatus } from '../features/spotify/commands'
import { SpotifyProviderMessage, SpotifyProviderModel } from '../features/spotify/domain'
import { browserPageLayer, GetPage } from './page-query'
import { AppRoute } from './route'
import {
  AppBootstrap,
  FollowPageLocation,
  InvalidatePages,
  ReadRouteLocation,
  ReportNavigation,
  RoutedApplication,
  RoutedApplicationMessage,
  RoutedApplicationNoDeps,
} from './routed-application'

const runWithLayer = <A, E, R>(program: Effect.Effect<A, E, R>, layer: Layer.Layer<R>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)

        return yield* Effect.provide(program, context)
      }),
    ),
  )

const bootstrap = () =>
  AppBootstrap.make({
    url: new URL('https://goosebumps.fm/about'),
    metadata: makeStaticSiteMetadata('Initial owner-a', 'Fixture', '/about'),
    identity: { principalId: 'owner-a', known: true, epoch: 0 },
    realm: 'fixture-request',
  })

const page = (path: string, principalId: string | null = 'owner-a') =>
  PageDocument.make({
    url: `https://goosebumps.fm${path}`,
    status: 200,
    principal: principalId
      ? { id: principalId, name: principalId, username: principalId, role: null }
      : null,
    principalKnown: true,
    items: [],
    title: `${path} ${principalId ?? 'anonymous'}`,
    description: 'Fixture',
    requestId: 'fixture-request',
    renderedAt: 1,
    skipSeen: false,
    tweet: null,
    neighbours: null,
    dashboard: null,
    profile: null,
    shows: null,
    changelog: null,
    publicAction: null,
    metadata: makeStaticSiteMetadata(`${path} ${principalId ?? 'anonymous'}`, 'Fixture', path),
    failure: null,
  })

const membershipLayer = Layer.merge(
  LoadMembership.toLayer((args) =>
    Effect.succeed(
      MembershipMessage.SucceededLoadMembership({ ...args, active: false, revision: 0 }),
    ),
  ),
  SaveMembership.toLayer(() => Effect.die(new Error('Unexpected membership mutation'))),
)

const spotifyLayer = Layer.merge(
  ReadSpotifyStatus.toLayer(() => Effect.succeed({ connected: false, name: '' })),
  PerformSpotify.toLayer(({ identity, requestId, revision }) =>
    Effect.succeed(
      SpotifyProviderMessage.CompletedOperation({
        identity,
        requestId,
        revision,
        status: null,
        notice: '',
      }),
    ),
  ),
)

const noRequestsLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() => Effect.die(new Error('Unexpected API request'))),
)

describe('native routed application', () => {
  it.each(['network', 'server', 'rate-limit'])(
    'retains verified anonymous public content across a %s public navigation failure',
    async (failure) => {
      let unavailable = false

      const props = AppBootstrap.make({
        ...bootstrap(),
        identity: { principalId: null, known: true, epoch: 0 },
      })

      const controllers = Layer.mergeAll(
        FollowPageLocation.layer,
        ReadRouteLocation.layer,
        InvalidatePages.layer,
      ).pipe(Layer.provideMerge(Router.memory({ routes: AppRoute, url: '/about' })))

      const documents = browserPageLayer(props.url, props.realm, async (input) => {
        const url = input instanceof Request ? new URL(input.url) : new URL(input)
        const document = page(url.pathname, null)

        if (!unavailable) return Response.json(document)

        if (failure === 'network') throw new Error('Fixture network unavailable')

        const status = failure === 'rate-limit' ? 429 : 503

        return Response.json(
          { ...document, status, failure: 'Fixture service unavailable' },
          { status },
        )
      })

      await runWithLayer(
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, props)
          yield* TestHost.settle
          const title = root.head<{ title: string }>().title
          expect(root.text()).toContain('/about anonymous')
          unavailable = true
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* TestHost.settle
          expect(root.text()).toContain('/about anonymous')
          expect(root.text()).toContain('Showing the last loaded content.')
          expect(root.head<{ title: string }>().title).toBe(title)
          expect(root.model()?.identity).toEqual({ principalId: null, known: true, epoch: 0 })
          yield* router.navigate('/privacy')
          yield* TestHost.settle
          const model = root.model()

          if (!model) throw new Error('Native routed root crashed')

          expect({
            path: router.location().url,
            route: AppRoute.print(model.route),
          }).toEqual({
            path: '/privacy',
            route: '/privacy',
          })
          expect(root.text()).toContain('/about anonymous')
          expect(root.text()).toContain('Showing the last loaded content.')
          expect(root.head<{ title: string }>().title).toBe(title)
        }).pipe(Effect.scoped),
        Layer.mergeAll(
          TestHost.layer(),
          documents,
          controllers,
          nativePlayerServerLayer,
          membershipLayer,
          spotifyLayer,
          noRequestsLayer,
          ReportNavigation.toLayer(() => Effect.void),
        ),
      )
    },
  )

  it('opens the shared search from station navigation and keyboard shortcuts without navigation reports', async () => {
    const props = bootstrap()
    const reports: Array<string> = []

    const controllers = Layer.mergeAll(
      FollowPageLocation.layer,
      ReadRouteLocation.layer,
      InvalidatePages.layer,
    ).pipe(Layer.provideMerge(Router.memory({ routes: AppRoute, url: '/about' })))

    await runWithLayer(
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, props)
        yield* TestHost.settle

        const search = root
          .all(Locator.attr('aria-label', 'Search'))
          .find((node) => Predicate.isTagged(node, 'Element') && node.dispatch !== undefined)

        if (
          search === undefined ||
          !Predicate.isTagged(search, 'Element') ||
          search.dispatch === undefined
        )
          throw new Error('Missing station search dispatch')

        search.dispatch('navigation-ready', () => NavigationMessage.Ready(), undefined)
        yield* TestHost.settle
        Locator.fire(search, 'click')
        yield* TestHost.settle
        expect(root.model()?.searchOpen).toBe(true)
        expect(root.get(Locator.attr('aria-label', 'Search query'))).toBeDefined()
        Locator.fire(root.get(Locator.attr('aria-label', 'Close search')), 'click')
        yield* TestHost.settle
        expect(root.model()?.searchOpen).toBe(false)
        yield* TestGlobalEvents.fire('document', 'keydown', { key: '/' })
        yield* TestHost.settle
        expect(root.model()?.searchOpen).toBe(true)
        expect(reports).toEqual([])
        yield* router.navigate('/privacy')
        yield* TestHost.settle
        expect(root.model()?.searchOpen).toBe(false)
        expect(reports).toEqual(['started', 'completed'])
        const mounted = root.log().filter((entry) => Predicate.isTagged(entry, 'Mounted'))
        expect(
          mounted.filter((entry) => entry.path.endsWith(`/SearchDialog[${props.realm}]`)),
        ).toHaveLength(1)
      }).pipe(Effect.scoped),
      Layer.mergeAll(
        TestHost.layer(),
        TestGlobalEvents.layer,
        GetPage.toLayer(({ path }) => Effect.succeed(page(path))),
        controllers,
        nativePlayerServerLayer,
        membershipLayer,
        spotifyLayer,
        noRequestsLayer,
        ReportNavigation.toLayer(({ phase }) =>
          Effect.sync(() => {
            reports.push(phase)
          }),
        ),
      ),
    )
  })

  it('keeps a global Spotify operation busy through same-account navigation and rejects an old-account completion', async () => {
    const props = { ...bootstrap(), url: new URL('https://goosebumps.fm/tweet/a') }
    const about = Promise.withResolvers<Response>()
    const aboutRequested = Promise.withResolvers<void>()
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    let operations = 0
    const initial = screen('a')

    const musicScreen = Schema.decodeUnknownSync(MicroPostScreenResponse)({
      ...initial,
      post: {
        ...initial.post,
        music: {
          entity: {
            id: 'record',
            type: 'album',
            title: 'The record',
            artistNames: ['Artist'],
            coverImageUrl: null,
          },
          links: [
            { platform: 'spotify', url: 'https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv' },
          ],
        },
      },
    })

    const documents = browserPageLayer(props.url, props.realm, async (input) => {
      const url = new URL(new Request(input).url)

      if (url.pathname === '/about') {
        aboutRequested.resolve()

        return about.promise
      }

      if (url.pathname === '/privacy') return Response.json(page('/privacy', 'owner-b'))

      return Response.json({ ...page('/tweet/a'), tweet: musicScreen })
    })

    const spotify = Layer.merge(
      ReadSpotifyStatus.toLayer(() => Effect.succeed({ connected: true, name: 'Listener' })),
      PerformSpotify.toLayer(({ identity, requestId, revision }) => {
        operations += 1
        const gate = operations === 1 ? first : second

        return Effect.promise(() => gate.promise).pipe(
          Effect.map((notice) =>
            SpotifyProviderMessage.CompletedOperation({
              identity,
              requestId,
              revision,
              status: null,
              notice,
            }),
          ),
        )
      }),
    )

    const controllers = Layer.mergeAll(
      FollowPageLocation.layer,
      ReadRouteLocation.layer,
      InvalidatePages.layer,
    ).pipe(Layer.provideMerge(Router.memory({ routes: AppRoute, url: '/tweet/a' })))

    await runWithLayer(
      Effect.gen(function* () {
        const router = yield* Router.Router
        const host = yield* TestHost.TestHost
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, props)

        const spotifyState = () => {
          const last = root
            .log()
            .filter((entry) => Predicate.isTagged(entry, 'Update'))
            .findLast((entry) => entry.path.endsWith('/SpotifyProvider[]'))

          if (last === undefined) throw new Error('Missing Spotify state update')

          return Schema.decodeUnknownSync(SpotifyProviderModel)(last.model)
        }

        yield* TestHost.settle
        Locator.fire(root.get(Locator.text('Play on Spotify')), 'click')
        yield* TestHost.settle
        expect(spotifyState().operation?.identity).toBe('owner-a')
        yield* router.navigate('/about')
        host.drain(10_000)
        yield* Effect.promise(() => aboutRequested.promise)
        expect(root.model()?.spotifyIdentity).toBe('owner-a')
        expect(spotifyState().operation?.identity).toBe('owner-a')
        about.resolve(Response.json(page('/about')))
        yield* TestHost.settle
        expect(spotifyState().operation?.identity).toBe('owner-a')
        first.resolve('First operation completed')
        yield* TestHost.settle
        expect(spotifyState().notice).toBe('First operation completed')
        yield* router.navigate('/tweet/a')
        yield* TestHost.settle
        Locator.fire(root.get(Locator.text('Play on Spotify')), 'click')
        yield* TestHost.settle
        yield* router.navigate('/privacy')
        yield* TestHost.settle
        expect(spotifyState().identity).toBe('owner-b')
        expect(spotifyState().operation).toBeNull()
        second.resolve('Private completion from owner-a')
        yield* TestHost.settle
        expect(spotifyState().notice).not.toContain('owner-a')
        const mounted = root.log().filter((entry) => Predicate.isTagged(entry, 'Mounted'))
        expect(mounted.filter((entry) => entry.path.endsWith('/SpotifyProvider[]'))).toHaveLength(1)
        expect(operations).toBe(2)
      }).pipe(Effect.scoped),
      Layer.mergeAll(
        TestHost.layer(),
        documents,
        controllers,
        nativePlayerServerLayer,
        membershipLayer,
        spotify,
        noRequestsLayer,
        ReportNavigation.toLayer(() => Effect.void),
      ),
    )
  })

  it.each(['anonymous', 'owner-a'])(
    'retains the %s reader and pending visit writes across loading and nonreader routes',
    async (identity) => {
      const principalId = identity === 'anonymous' ? null : identity

      const props = {
        ...bootstrap(),
        url: new URL('https://goosebumps.fm/tweet/a'),
        identity: { principalId, known: true, epoch: 0 },
      }

      const seen = Promise.withResolvers<Response>()
      const visitStarted = Promise.withResolvers<void>()
      const aboutRequested = Promise.withResolvers<void>()
      const about = Promise.withResolvers<Response>()

      const readerPage = (slug: string) => ({
        ...page(`/tweet/${slug}`, principalId),
        tweet: screen(slug),
      })

      const apiLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) => {
          if (url.pathname.endsWith('/seen')) {
            visitStarted.resolve()

            return Effect.promise(() => seen.promise).pipe(
              Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
            )
          }

          return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json([])))
        }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl('https://goosebumps.fm'))),
      )

      const documents = browserPageLayer(props.url, props.realm, async (input) => {
        const url = new URL(new Request(input).url)

        if (url.pathname === '/about') {
          aboutRequested.resolve()

          return about.promise
        }

        return Response.json(readerPage(url.pathname.split('/').at(-1) ?? 'a'))
      })

      const controllers = Layer.mergeAll(
        FollowPageLocation.layer,
        ReadRouteLocation.layer,
        InvalidatePages.layer,
      ).pipe(Layer.provideMerge(Router.memory({ routes: AppRoute, url: '/tweet/a' })))

      await runWithLayer(
        Effect.gen(function* () {
          const router = yield* Router.Router
          const host = yield* TestHost.TestHost
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, props)
          yield* TestHost.settle

          const control = root
            .all(Locator.attr('href', '/tweet/latest'))
            .find((node) => Predicate.isTagged(node, 'Element') && node.dispatch !== undefined)

          if (
            control === undefined ||
            !Predicate.isTagged(control, 'Element') ||
            control.dispatch === undefined
          )
            throw new Error('Missing native reader dispatch')

          control.dispatch(
            'reader-mounted',
            () =>
              ReaderPageMessage.CommittedReader({
                identity,
                slug: 'a',
                navigationId: 0,
                generation: 0,
              }),
            undefined,
          )
          host.drain(10_000)
          yield* Effect.promise(() => visitStarted.promise)
          yield* router.navigate('/about')
          host.drain(10_000)
          yield* Effect.promise(() => aboutRequested.promise)
          expect(root.get(Locator.attr('data-reader-active', 'false'))).toMatchObject({
            attrs: { hidden: '' },
          })

          if (principalId !== null) expect(root.text()).not.toContain('Tweet a')
          about.resolve(Response.json(page('/about', principalId)))
          seen.resolve(Response.json({ recorded: true }))
          yield* TestHost.settle
          expect(root.model()?.readerPath).toBe('/tweet/a')
          expect(root.text()).toContain(`/about ${identity}`)
          yield* router.navigate('/tweet/b')
          yield* TestHost.settle
          expect(root.get(Locator.attr('data-reader-active', 'true'))).toBeDefined()
          expect(root.model()?.readerPath).toBe('/tweet/b')
          expect(root.model()?.identity.epoch).toBe(principalId === null ? 1 : 2)
          const mounted = root.log().filter((entry) => Predicate.isTagged(entry, 'Mounted'))

          const readerMounts = mounted.filter((entry) =>
            entry.path.endsWith(`/ReaderPage[reader:${identity}]`),
          )

          expect(readerMounts).toHaveLength(1)

          const updates = root
            .log()
            .filter((entry) => Predicate.isTagged(entry, 'Update'))
            .filter((entry) => entry.path.endsWith(`/ReaderPage[reader:${identity}]`))

          const last = updates.at(-1)

          if (last === undefined) throw new Error('Missing reader state update')

          const state = yield* Schema.decodeUnknownEffect(ReaderPageModel)(last.model)
          expect(state.visits.a).toBe('recorded')
        }).pipe(Effect.scoped),
        Layer.mergeAll(
          TestHost.layer(),
          documents,
          controllers,
          nativePlayerServerLayer,
          membershipLayer,
          spotifyLayer,
          apiLayer,
          ReportNavigation.toLayer(() => Effect.void),
        ),
      )
    },
  )

  it('server-renders the complete page and exactly one stable owner of each shared service', async () => {
    const props = bootstrap()
    const entries: Array<MessageLog.Entry> = []
    let loads = 0

    const rendered = await runWithLayer(
      HtmlServer.renderToHtml(RoutedApplication, props, { budget: '5 seconds' }).pipe(
        Effect.provideService(MessageLog.MessageLog, {
          enabled: true,
          record: (entry) => entries.push(entry),
        }),
      ),
      Layer.mergeAll(
        GetPage.toLayer(() => {
          loads += 1

          return Effect.succeed(page('/about'))
        }),
        Router.static({ routes: AppRoute, url: '/about' }),
        nativePlayerServerLayer,
        noRequestsLayer,
      ),
    )

    expect(rendered.model).toBeDefined()
    expect(rendered.html).toContain('/about owner-a')
    expect(rendered.html).toContain('Mixes via RSS')
    expect(rendered.html.match(/class="mobile-dock(?:\s|")/g)).toHaveLength(1)
    expect(rendered.html).toContain('Theme: system')
    expect(rendered.html).not.toContain('max-w-5xl justify-end px-4 py-3')
    expect(rendered.head).toContain('https://goosebumps.fm/about')
    expect(loads).toBe(1)
    expect(entries.filter((entry) => Predicate.isTagged(entry, 'Failed'))).toEqual([])
    const mounted = entries.filter((entry) => Predicate.isTagged(entry, 'Mounted'))
    expect(
      mounted.filter((entry) => entry.path.endsWith('/StationNavigation[]/ThemeControls[]')),
    ).toHaveLength(1)
    expect(mounted.filter((entry) => entry.path.endsWith('/PlayerProvider[]'))).toHaveLength(1)
    expect(mounted.filter((entry) => entry.path.endsWith('/MembershipProvider[]'))).toHaveLength(1)
    expect(mounted.filter((entry) => entry.path.endsWith('/SpotifyProvider[]'))).toHaveLength(1)
    expect(mounted.filter((entry) => entry.path.endsWith('/MediaPreviewBoundary[]'))).toHaveLength(
      1,
    )
    expect(Object.keys(rendered.model ?? {})).not.toContain('page')
  })

  it('clears personalized content and head while preserving playback through navigation and history', async () => {
    const props = bootstrap()
    const pending = Promise.withResolvers<Response>()
    const requested = Promise.withResolvers<void>()
    const reports: Array<string> = []
    let principal = 'owner-a'
    let loads = 0
    let snapshotSubscriptions = 0

    const track = QueueTrack.make({
      id: 'playing',
      slug: 'playing',
      title: 'Uninterrupted fixture mix',
      url: '/fixture.mp3',
      thumbnailUrl: null,
      type: 'mix',
    })

    const snapshots = Layer.succeed(PlayerSnapshotSource, {
      snapshots: Stream.fromEffect(
        Effect.sync(() => {
          snapshotSubscriptions += 1

          return {
            ...initialSnapshot,
            queue: { tracks: [track], currentIndex: 0, current: track },
          }
        }),
      ),
    })

    const pageLayer = browserPageLayer(props.url, props.realm, async (input) => {
      loads += 1
      const url = new URL(new Request(input).url)

      if (url.pathname === '/privacy' && principal === 'owner-a') {
        requested.resolve()

        return pending.promise
      }

      return Response.json(page(url.pathname, principal))
    })

    const routerLayer = Router.memory({ routes: AppRoute, url: '/about' })

    const controllers = Layer.mergeAll(
      FollowPageLocation.layer,
      ReadRouteLocation.layer,
      InvalidatePages.layer,
    ).pipe(Layer.provideMerge(routerLayer))

    await runWithLayer(
      Effect.gen(function* () {
        const router = yield* Router.Router
        const host = yield* TestHost.TestHost
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, props)
        yield* TestHost.settle
        expect(root.text()).toContain('/about owner-a')
        expect(root.text()).toContain(track.title)
        expect(reports).toEqual([])
        yield* router.navigate('/privacy')
        host.drain(10_000)
        yield* Effect.promise(() => requested.promise)
        expect(root.text()).not.toContain('/about owner-a')
        expect(root.head<{ title: string }>().title).not.toContain('owner-a')
        expect(root.text()).toContain(track.title)
        principal = 'owner-b'
        pending.resolve(Response.json(page('/privacy', principal)))
        yield* TestHost.settle
        expect(root.text()).toContain('/privacy owner-b')
        expect(root.model()?.identity.epoch).toBe(1)
        expect(reports).toEqual(['started', 'completed'])
        yield* router.back
        yield* TestHost.settle
        expect(root.text()).toContain('/about owner-b')
        expect(root.model()?.navigationAction).toBe('pop')
        expect(root.model()?.identity.epoch).toBe(2)
        expect(loads).toBe(3)
        expect(snapshotSubscriptions).toBe(1)
        expect(
          root
            .log()
            .filter((entry) => Predicate.isTagged(entry, 'Mounted'))
            .filter((entry) => entry.path.endsWith('/MediaPreviewBoundary[]')),
        ).toHaveLength(1)
        const mounted = root.log().filter((entry) => Predicate.isTagged(entry, 'Mounted'))
        expect(mounted.filter((entry) => entry.path.endsWith('/PlayerProvider[]'))).toHaveLength(1)
        expect(
          mounted.filter((entry) => entry.path.endsWith('/MembershipProvider[]')),
        ).toHaveLength(1)
        expect(mounted.filter((entry) => entry.path.endsWith('/SpotifyProvider[]'))).toHaveLength(1)
      }).pipe(Effect.scoped),
      Layer.mergeAll(
        TestHost.layer(),
        pageLayer,
        controllers,
        snapshots,
        PerformPlayer.toLayer(() => Effect.succeed(Component.noop)),
        membershipLayer,
        spotifyLayer,
        noRequestsLayer,
        ReportNavigation.toLayer(({ phase }) =>
          Effect.sync(() => {
            reports.push(phase)
          }),
        ),
      ),
    )
  })

  it('accepts canonical replacements and explicit authentication refreshes without reseeding identity', async () => {
    const props = bootstrap()
    const requests: Array<string> = []
    const reports: Array<string> = []

    const layer = browserPageLayer(props.url, props.realm, async (input) => {
      const url = new URL(new Request(input).url)
      requests.push(url.pathname)

      return Response.json(page('/privacy', 'owner-b'))
    })

    const controllers = Layer.mergeAll(
      FollowPageLocation.layer,
      ReadRouteLocation.layer,
      InvalidatePages.layer,
    ).pipe(Layer.provideMerge(Router.memory({ routes: AppRoute, url: '/about' })))

    await runWithLayer(
      Effect.gen(function* () {
        const router = yield* Router.Router

        const root = yield* TestHost.mount(RoutedApplicationNoDeps, {
          ...props,
          identity: { principalId: null, known: false, epoch: 0 },
        })

        yield* TestHost.settle
        expect(router.location().url).toBe('/privacy')
        expect(router.location().action).toBe('replace')
        expect(root.text()).toContain('/privacy owner-b')
        expect(root.model()?.identity).toEqual({ principalId: null, known: false, epoch: 1 })
        expect(requests).toEqual(['/about', '/privacy'])
        root.send(RoutedApplicationMessage.ChangedAuthentication())
        yield* TestHost.settle
        expect(root.model()?.identity.epoch).toBe(2)
        expect(root.text()).toContain('/privacy owner-b')
        expect(requests).toEqual(['/about', '/privacy', '/privacy'])
        expect(reports).toEqual(['started', 'completed', 'started', 'completed'])
      }).pipe(Effect.scoped),
      Layer.mergeAll(
        TestHost.layer(),
        layer,
        controllers,
        nativePlayerServerLayer,
        membershipLayer,
        spotifyLayer,
        noRequestsLayer,
        ReportNavigation.toLayer(({ phase }) =>
          Effect.sync(() => {
            reports.push(phase)
          }),
        ),
      ),
    )
  })
})
