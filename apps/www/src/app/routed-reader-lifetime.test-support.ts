import { Router } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { makeStaticSiteMetadata } from '@gbfm/site-metadata'
import { Effect, Layer, Predicate, Schema, type Scope } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'

import { nativePlayerServerLayer } from '../features/player/provider'
import { LoadMembership, SaveMembership } from '../features/public-actions/commands'
import { MembershipMessage } from '../features/public-actions/domain'
import { ReaderCheckpointStore } from '../features/reader/checkpoint-store'
import { ReaderPageMessage, ReaderPageModel, ReaderPageProps } from '../features/reader/contracts'
import { screen, neighbours } from '../features/reader/fixtures.test-support'
import { concreteSlug, isEntry } from '../features/reader/location'
import { PerformSpotify, ReadSpotifyStatus } from '../features/spotify/commands'
import { pageFixture } from '../server/page-fixture.test-support'
import { browserPageLayer } from './page-query'
import { AppRoute } from './route'
import {
  AppBootstrap,
  FollowPageLocation,
  InvalidatePages,
  ReadRouteLocation,
  ReportNavigation,
  type RoutedApplicationModel,
  type RoutedApplicationMessage,
} from './routed-application'

export type ReaderLifetimeRoot = TestHost.TestRoot<
  RoutedApplicationModel,
  typeof RoutedApplicationMessage.Type,
  never
>

export const readerDocument = (path: string, status = 200) => {
  const document = pageFixture(path).flags
  const slug = concreteSlug(document.url)

  return {
    ...document,
    status,
    title: slug ? `Tweet ${slug}` : path,
    tweet: status === 200 && slug ? screen(slug) : null,
    failure: status === 200 ? null : 'Tweet unavailable.',
  }
}

export const readerResponse = (path: string, status = 200) =>
  Response.json(readerDocument(path, status), { status })

export const makeReaderLifetimeFixture = (start: string, stored: string | null = null) => {
  const props = AppBootstrap.make({
    url: new URL(start, 'https://preview.example.test'),
    metadata: makeStaticSiteMetadata('Reader lifetime', 'Disposable reader fixture', start),
    identity: { principalId: null, known: true, epoch: 0 },
    realm: 'reader-lifetime-fixture',
  })

  const pages = new Map<string, Array<Response | Promise<Response> | Error>>()
  const replies: Array<Response | Promise<Response>> = []
  const reads: Array<Promise<string | null>> = []
  const checkpointReads: Array<string> = []
  const pageRequests: Array<string> = []
  const apiRequests: Array<string> = []
  const writes: Array<{ identity: string; slug: string | null }> = []
  const focus: Array<Element> = []
  const storage = new Map<string, string | null>([['anonymous', stored]])

  const checkpoints = Layer.succeed(ReaderCheckpointStore, {
    read: (identity) => {
      checkpointReads.push(identity)
      const deferred = reads.shift()

      return deferred
        ? Effect.promise(() => deferred)
        : Effect.succeed(storage.get(identity) ?? null)
    },
    write: (identity, slug) =>
      Effect.sync(() => {
        writes.push({ identity, slug })
        storage.set(identity, slug)
      }),
  })

  const documents = browserPageLayer(props.url, props.realm, async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    url.searchParams.delete('__data')
    const path = `${url.pathname}${url.search}`
    pageRequests.push(path)
    const queued = pages.get(path)?.shift()

    if (queued instanceof Error) throw queued

    if (queued) return queued

    if (path === '/tweet/latest') return readerResponse('/tweet/newest')

    return readerResponse(path)
  })

  const api = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      apiRequests.push(`${request.method} ${url.pathname}`)

      if (url.pathname.endsWith('/seen'))
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, Response.json({ recorded: true })),
        )

      if (url.pathname.endsWith('/screen/replies')) {
        const response = replies.shift() ?? Response.json([])

        return Effect.promise(async () => HttpClientResponse.fromWeb(request, await response))
      }

      if (url.pathname.endsWith('/neighbours'))
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, Response.json({ ...neighbours, seen: true })),
        )

      return Effect.die(
        new Error(`Unexpected reader fixture API: ${request.method} ${url.pathname}`),
      )
    }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(props.url.origin))),
  )

  const controllers = Layer.mergeAll(
    FollowPageLocation.layer,
    ReadRouteLocation.layer,
    InvalidatePages.layer,
  ).pipe(Layer.provideMerge(Router.memory({ routes: AppRoute, url: start })))

  const memberships = Layer.merge(
    LoadMembership.toLayer((args) =>
      Effect.succeed(
        MembershipMessage.SucceededLoadMembership({ ...args, active: false, revision: 0 }),
      ),
    ),
    SaveMembership.toLayer(() => Effect.die(new Error('Unexpected membership write'))),
  )

  const spotify = Layer.merge(
    ReadSpotifyStatus.toLayer(() => Effect.succeed({ connected: false, name: '' })),
    PerformSpotify.toLayer(() => Effect.die(new Error('Unexpected Spotify operation'))),
  )

  const layer = Layer.mergeAll(
    TestHost.layer(),
    controllers,
    documents,
    api,
    checkpoints,
    nativePlayerServerLayer,
    memberships,
    spotify,
    ReportNavigation.toLayer(() => Effect.void),
    Layer.succeed(Html.Host, {
      focus: (element) => {
        focus.push(element)
      },
      blur: () => {},
      scrollIntoView: () => {},
      measure: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
      select: () => {},
      requestSubmit: () => false,
      showPicker: () => false,
    }),
  )

  return {
    props,
    layer,
    pages,
    replies,
    reads,
    checkpointReads,
    storage,
    writes,
    pageRequests,
    apiRequests,
    focus,
  }
}

export const pumpReaderUntil = (ready: () => boolean) =>
  Effect.gen(function* () {
    const host = yield* TestHost.TestHost

    for (let attempt = 0; attempt < 100; attempt++) {
      host.drain(10_000)

      if (ready()) return
      yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)))
    }

    throw new Error('Native reader did not reach the expected lifecycle boundary')
  })

export const runReaderLifetime = <A, E, R>(
  fixture: { readonly layer: Layer.Layer<R> },
  program: Effect.Effect<A, E, R | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(fixture.layer)

        return yield* Effect.provide(program, context)
      }),
    ),
  )

export const readerState = (root: ReaderLifetimeRoot) => {
  const entry = root
    .log()
    .findLast(
      (entry) =>
        (Predicate.isTagged(entry, 'Mounted') || Predicate.isTagged(entry, 'Update')) &&
        entry.path.endsWith('/ReaderPage[reader:anonymous]'),
    )

  if (!entry || (!Predicate.isTagged(entry, 'Mounted') && !Predicate.isTagged(entry, 'Update')))
    throw new Error('Reader has not mounted')

  return {
    model: Schema.decodeUnknownSync(ReaderPageModel)(entry.model),
    props: Schema.decodeUnknownSync(ReaderPageProps)(entry.props),
  }
}

export const activateRenderedReader = (root: ReaderLifetimeRoot, currentUrl: string) => {
  const slug = concreteSlug(new URL(currentUrl, 'https://preview.example.test'))
  const { model, props } = readerState(root)

  if (
    !slug ||
    props.active === false ||
    props.status !== 200 ||
    root.model()?.pending ||
    props.screen?.post.slug !== slug ||
    concreteSlug(props.url) !== slug ||
    model.reserved !== slug ||
    root.model()?.navigationId !== model.navigationId
  )
    return false
  const active = root.query(Locator.attr('data-reader-active', 'true'))

  if (
    !active ||
    !Predicate.isTagged(active, 'Element') ||
    active.attrs.hidden !== undefined ||
    active.attrs['data-reader-request'] !== String(model.navigationId)
  )
    return false
  const article = root.query(Locator.attr('data-tweet-swipe', slug))

  if (!article) return false

  const control = root
    .all(Locator.attr('href', '/tweet/latest'))
    .find((node) => Predicate.isTagged(node, 'Element') && node.dispatch !== undefined)

  if (!control || !Predicate.isTagged(control, 'Element') || !control.dispatch)
    throw new Error('Committed reader has no live native actor')
  control.dispatch(
    'fixture:reader-committed',
    () =>
      ReaderPageMessage.CommittedReader({
        identity: model.identity,
        generation: model.generation,
        navigationId: model.navigationId,
        slug,
      }),
    undefined,
  )

  return true
}

export const renderedResume = (root: ReaderLifetimeRoot, currentUrl: string) => {
  const { model, props } = readerState(root)

  if (!isEntry(currentUrl) && !model.entryFallback) return null

  if (
    props.active === false ||
    root.model()?.pending ||
    (!model.entryResolved && !model.entryFallback)
  )
    return null
  const target = model.resumeSlug ?? model.checkpoint
  const href = target ? `/tweet/${encodeURIComponent(target)}` : '/tweet/latest'

  const link = root.all(Locator.attr('href', href)).find((node) => {
    const text = Locator.textOf(node)

    return text === 'Resume reading' || text === 'Start reading'
  })

  return link ? href : null
}
