import { Command, Component, Head, Router, UiSchema } from '@effect/ui'
import { Html, HtmlHead } from '@effect/ui/html'
import { makeStaticSiteMetadata, SiteMetadata } from '@gbfm/site-metadata'
import { Effect, Layer, Option, Redacted, Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'

import { PageDocument } from '../domain/page'
import { MediaPreviewBoundary } from '../features/media-preview/mount'
import { StationNavigation } from '../features/navigation/station-navigation'
import { PlayerProvider } from '../features/player/provider'
import { PersistentPlayer } from '../features/player/view'
import { membershipCommandsLayer, MembershipProvider } from '../features/public-actions/provider'
import { parseCheckpoint } from '../features/reader/location'
import { SearchDialog } from '../features/search/dialog'
import { spotifyCommandsLayer, SpotifyProvider } from '../features/spotify/provider'
import { parseRoute, Route as PageRoute } from '../route'
import { navigationCompleted, navigationStarted } from './browser-runtime'
import { siteHead } from './head'
import { PageContent, ReaderContent } from './page-content'
import {
  GetPage,
  PageIdentity,
  PageQueryArgs,
  pageIdentityForNavigation,
  pageQueryArgs,
  type PageQueryError,
} from './page-query'
import { ReaderNeighbourPrefetch, readerNeighbourPageArgs } from './reader-prefetch'
import {
  AppRoute,
  isPageUrl,
  isPrivatePageUrl,
  routeFromUrl,
  routeSubscription,
  routeUrl,
} from './route'

export const AppBootstrap = Schema.Struct({
  url: Schema.URL,
  metadata: SiteMetadata,
  identity: PageIdentity,
  realm: Schema.NonEmptyString,
})

export type AppBootstrap = typeof AppBootstrap.Type

const NavigationAction = Schema.Literals(['initial', 'push', 'replace', 'pop'])

export const RoutedApplicationModel = Schema.Struct({
  route: AppRoute,
  identity: PageIdentity,
  pending: Schema.Boolean,
  searchOpen: Schema.Boolean,
  navigationId: Schema.Number,
  navigationAction: Schema.NullOr(NavigationAction),
  readerPath: Schema.NullOr(Schema.String),
  readerEpoch: Schema.Number,
  spotlightPath: Schema.NullOr(Schema.String),
  readerPrincipalId: Schema.NullOr(Schema.String),
  spotifyIdentity: Schema.String,
  membershipPrincipalId: Schema.NullOr(Schema.String),
  membershipPrincipalKnown: Schema.Boolean,
})

export type RoutedApplicationModel = typeof RoutedApplicationModel.Type

export const RoutedApplicationMessage = UiSchema.TaggedEnum({
  ChangedRoute: { route: AppRoute },
  ChangedPage: {},
  RequestedSearchNavigation: {},
  RequestedCloseSearch: {},
  ChangedAuthentication: {},
  ClickedRetryPage: {},
  ObservedRouteLocation: {
    held: AppRoute,
    navigationId: Schema.Number,
    action: NavigationAction,
  },
})

export class ReadRouteLocation extends Command.Service<ReadRouteLocation>()(
  'app/ReadRouteLocation',
  {
    args: { held: AppRoute, navigationId: Schema.Number },
    success: RoutedApplicationMessage.cases.ObservedRouteLocation,
  },
) {
  static readonly layer = this.toLayer(
    Effect.map(
      Router.Router,
      (router) =>
        ({ held, navigationId }) =>
          Effect.sync(() =>
            RoutedApplicationMessage.ObservedRouteLocation({
              held,
              navigationId,
              action: router.location().action,
            }),
          ),
    ),
  )
}

export class ReportNavigation extends Command.Service<ReportNavigation>()('app/ReportNavigation', {
  args: { phase: Schema.Literals(['started', 'completed']) },
  success: Schema.Void,
  mode: 'queue',
}) {
  static readonly layer = this.toLayer(({ phase }) =>
    Effect.sync(() => {
      if (phase === 'started') navigationStarted()
      else navigationCompleted()
    }),
  )
}

export class InvalidatePages extends Command.Service<InvalidatePages>()('app/InvalidatePages', {
  args: {},
  success: Schema.Void,
  invalidates: () => [GetPage],
}) {
  static readonly layer = this.toLayer(() => Effect.void)
}

export class FollowPageLocation extends Command.Service<FollowPageLocation>()(
  'app/FollowPageLocation',
  {
    args: { held: AppRoute, url: Schema.Redacted(Schema.URL), replace: Schema.Boolean },
    success: Router.PatchOutcome,
  },
) {
  static readonly layer = this.toLayer(
    Effect.map(Router.Router, (router) => ({ held, url: redacted, replace }) => {
      if (router.location().url !== AppRoute.print(held)) return Effect.succeed('stale')

      const url = Redacted.value(redacted)

      if (!isPageUrl(url)) return router.load(url.href)

      return router.navigate(`${url.pathname}${url.search}${url.hash}`, { replace })
    }),
  )
}

export const currentPageDocument = (
  result: AsyncResult.AsyncResult<PageDocument, PageQueryError>,
): PageDocument | undefined =>
  AsyncResult.isSuccess(result) && !result.waiting ? result.value : undefined

const pathOf = (url: URL) => `${url.pathname}${url.search}`

const readerKey = (realm: string, principalId: string | null) =>
  `${realm}:reader:${principalId === null ? 'anonymous' : `principal:${encodeURIComponent(principalId)}`}`

const dashboardContentKey = (realm: string, principalId: string | null, url: URL) =>
  principalId !== null && PageRoute.guards.Dashboard(parseRoute(url.pathname))
    ? `${realm}:dashboard:${encodeURIComponent(principalId)}:${pathOf(url)}`
    : null

export const isReaderPageDocument = (page: PageDocument) => {
  const url = URL.parse(page.url)

  if (url === null) return false

  const route = parseRoute(url.pathname)

  return (
    ((PageRoute.guards.Listing(route) || PageRoute.guards.Detail(route)) &&
      route.kind === 'tweets') ||
    url.pathname === '/tweet'
  )
}

export const isPublicReaderDocument = (page: PageDocument) =>
  isReaderPageDocument(page) && isPublicPageDocument(page)

export const isPublicPageDocument = (page: PageDocument) => {
  const url = URL.parse(page.url)

  return (
    url !== null &&
    !isPrivatePageUrl(url) &&
    page.principal === null &&
    page.principalKnown !== false &&
    page.dashboard === null &&
    (page.listening === null || page.listening === undefined) &&
    page.status === 200 &&
    page.failure === null &&
    !page.items.some((item) => item.draft) &&
    !page.tweet?.post.draft &&
    !page.tweet?.root.draft &&
    !page.tweet?.quote?.draft &&
    !page.tweet?.replies.some((reply) => reply.draft)
  )
}

export const visiblePageDocument = (
  result: AsyncResult.AsyncResult<PageDocument, PageQueryError>,
  url: URL,
  identity: PageIdentity,
): PageDocument | undefined => {
  const current = currentPageDocument(result)

  if (current) return current

  if (!identity.known || identity.principalId !== null || isPrivatePageUrl(url)) return undefined

  if (AsyncResult.isFailure(result)) {
    const error = Option.getOrUndefined(AsyncResult.error(result))

    if (
      error?.reason === 'identity' ||
      error?.reason === 'origin' ||
      error?.reason === 'redirect' ||
      (error !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429)
    )
      return undefined
  }

  const previous = Option.getOrUndefined(AsyncResult.value(result))

  if (!previous || !isPublicPageDocument(previous)) return undefined
  const previousUrl = URL.parse(previous.url, url)

  return previousUrl?.origin === url.origin && pathOf(previousUrl) === pathOf(url)
    ? previous
    : undefined
}

export const retainedSpotlightDocument = (
  page: PageDocument | undefined,
  url: URL,
  identity: PageIdentity,
): PageDocument | undefined => {
  if (!page || !identity.known || identity.principalId !== null || !isPublicPageDocument(page))
    return undefined
  const previous = URL.parse(page.url)

  if (!previous || previous.origin !== url.origin || previous.pathname !== url.pathname)
    return undefined
  const route = parseRoute(url.pathname)

  if (
    !PageRoute.guards.Detail(route) ||
    route.kind !== 'editorial' ||
    !page.items.some((item) => item.richContent?.layout === 'spotlight')
  )
    return undefined
  const next = new URL(url)
  previous.searchParams.delete('at')
  next.searchParams.delete('at')

  return previous.search === next.search ? page : undefined
}

export const failedReaderPushReturn = (
  page: PageDocument | undefined,
  url: URL,
  identity: PageIdentity,
  action: typeof NavigationAction.Type | null,
  error: PageQueryError | undefined,
): URL | undefined => {
  if (
    action !== 'push' ||
    !error ||
    error.reason !== 'transport' ||
    !identity.known ||
    identity.principalId !== null ||
    !page ||
    !isPublicReaderDocument(page) ||
    !page.tweet
  )
    return undefined
  const source = URL.parse(page.url)
  const target = parseRoute(url.pathname)

  if (
    !source ||
    source.origin !== url.origin ||
    source.href === url.href ||
    !PageRoute.guards.Detail(target) ||
    target.kind !== 'tweets' ||
    parseCheckpoint(target.slug) === null ||
    ![page.neighbours?.newer, page.neighbours?.older].some((slug) => slug === target.slug)
  )
    return undefined

  return source
}

const sameSpotlightPositionPath = (previous: URL, next: URL) => {
  const before = new URL(previous)
  const after = new URL(next)
  before.searchParams.delete('at')
  after.searchParams.delete('at')

  return (
    before.origin === after.origin &&
    before.pathname === after.pathname &&
    before.search === after.search
  )
}

const nextIdentity = (identity: PageIdentity): PageIdentity => ({
  principalId: null,
  known: false,
  epoch: identity.epoch + 1,
})

const startedNavigation = () => ReportNavigation.make({ phase: 'started' }).pipe(Command.asNoop)

const completedNavigation = () => ReportNavigation.make({ phase: 'completed' }).pipe(Command.asNoop)

const RoutedChromeMessage = UiSchema.TaggedEnum({
  RequestedSearchStationNavigation: {},
  RequestedOpenSearchDialog: {},
  RequestedCloseSearchDialog: {},
  RequestedRefreshPageContent: {},
})

const RoutedChromeEvents = UiSchema.TaggedEnum({
  RequestedSearch: {},
  RequestedCloseSearch: {},
  RequestedRefresh: {},
})

const RoutedChrome = Html.component({
  name: 'RoutedChrome',
  props: Schema.Struct({
    url: Schema.URL,
    realm: Schema.String,
    epoch: Schema.Number,
    page: Schema.NullOr(PageDocument),
    reader: Schema.NullOr(PageDocument),
    readerUrl: Schema.NullOr(Schema.URL),
    readerPrincipalId: Schema.NullOr(Schema.String),
    dashboardPrincipalId: Schema.NullOr(Schema.String),
    readerActive: Schema.Boolean,
    readerPending: Schema.Boolean,
    spotlightPending: Schema.Boolean,
    readerPrefetchPages: Schema.Array(PageQueryArgs),
    navigationId: Schema.Number,
    navigationAction: Schema.NullOr(NavigationAction),
    pending: Schema.Boolean,
    failed: Schema.Boolean,
    searchOpen: Schema.Boolean,
  }),
  model: Schema.Null,
  message: RoutedChromeMessage,
  events: RoutedChromeEvents,
  restore: false,
}).make({
  init: () => null,
  update: {
    RequestedSearchStationNavigation: ($) => $.emit(RoutedChromeEvents.RequestedSearch()),
    RequestedOpenSearchDialog: ($) => $.emit(RoutedChromeEvents.RequestedSearch()),
    RequestedCloseSearchDialog: ($) => $.emit(RoutedChromeEvents.RequestedCloseSearch()),
    RequestedRefreshPageContent: ($) => $.emit(RoutedChromeEvents.RequestedRefresh()),
  },
  view: (h) => {
    const { page, reader, readerUrl, url } = h.props
    const principal = page?.principal ?? null
    const principalKnown = page ? (page.principalKnown ?? true) : false

    const retainedDashboardKey = dashboardContentKey(
      h.props.realm,
      h.props.dashboardPrincipalId,
      url,
    )

    const dashboardContent = () =>
      h.keepAlive(
        ({ key, props }) => {
          const retained = dashboardContentKey(props.realm, props.dashboardPrincipalId, props.url)

          return retained !== null && key === retained
        },
        (s) => {
          if (page && h.props.navigationAction !== null && retainedDashboardKey !== null) {
            return PageContent(s, {
              key: retainedDashboardKey,
              props: {
                page,
                navigationId: h.props.navigationId,
                navigationAction: h.props.navigationAction,
                active: true,
              },
              onEmit: {
                RequestedRefresh: () => RoutedChromeMessage.RequestedRefreshPageContent(),
              },
            })
          }

          return null
        },
      )

    const content = () => {
      if (page && (h.props.navigationAction !== null || h.props.spotlightPending)) {
        if (isReaderPageDocument(page) || retainedDashboardKey !== null) return h.text('')

        return PageContent(h, {
          key: `${h.props.realm}:${h.props.epoch}:${isPrivatePageUrl(url) ? 'private' : 'public'}`,
          props: {
            page,
            navigationId: h.props.navigationId,
            navigationAction: h.props.navigationAction ?? 'replace',
            active: true,
          },
          onEmit: {
            RequestedRefresh: () => RoutedChromeMessage.RequestedRefreshPageContent(),
          },
        })
      }

      if (h.props.failed)
        return h.section
          .class('page')
          .children(
            h.p.attr('role', 'alert').children('This page is unavailable. Try again.'),
            h.button
              .attr('type', 'button')
              .on('click', RoutedChromeMessage.RequestedRefreshPageContent())
              .children('Retry'),
          )

      return h.section.class('page').attr('role', 'status').children('Loading page…')
    }

    const site = h.div.class('site').children(
      h.props.readerPrefetchPages.length > 0
        ? ReaderNeighbourPrefetch(h, {
            key: JSON.stringify(h.props.readerPrefetchPages),
            props: { pages: h.props.readerPrefetchPages },
          })
        : null,
      SearchDialog(h, {
        key: h.props.realm,
        props: {
          open: h.props.searchOpen,
          showTrigger: false,
          queryScope: {
            realm: h.props.realm,
            principalId: principal?.id ?? null,
            known: principalKnown,
            epoch: h.props.epoch,
            origin: url.origin,
          },
        },
        onEmit: {
          RequestedOpen: () => RoutedChromeMessage.RequestedOpenSearchDialog(),
          RequestedClose: () => RoutedChromeMessage.RequestedCloseSearchDialog(),
        },
      }),
      StationNavigation(h, {
        props: { url: url.href, principal, principalKnown },
        onEmit: {
          RequestedSearch: () => RoutedChromeMessage.RequestedSearchStationNavigation(),
        },
      }),
      h.props.pending
        ? h.div
            .attr('role', 'status')
            .attr('aria-label', 'Loading page')
            .class('pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-highlight')
        : null,
      h.main
        .key('main-content')
        .attr('id', 'main-content')
        .attr('aria-busy', String(page === null || h.props.navigationAction === null))
        .children(
          h.keepAlive(
            ({ key, props }) => key === readerKey(props.realm, props.readerPrincipalId),
            (s) =>
              readerUrl
                ? h.div
                    .attr(
                      'hidden',
                      (page === reader && h.props.navigationAction !== null) ||
                        h.props.readerPending
                        ? undefined
                        : '',
                    )
                    .attr('inert', h.props.readerActive ? undefined : '')
                    .children(
                      ReaderContent(s, {
                        key: readerKey(h.props.realm, h.props.readerPrincipalId),
                        props: {
                          page: reader,
                          url: readerUrl,
                          principalId: h.props.readerPrincipalId,
                          navigationId: h.props.navigationId,
                          navigationAction: h.props.navigationAction ?? 'initial',
                          active: h.props.readerActive,
                          visible: h.props.readerActive || h.props.readerPending,
                        },
                        onEmit: {
                          RequestedRefresh: () => RoutedChromeMessage.RequestedRefreshPageContent(),
                        },
                      }),
                    )
                : null,
          ),
          dashboardContent(),
          content(),
          h.props.failed && page
            ? h.section
                .class('page')
                .attr('role', 'alert')
                .children(
                  h.p.children('Could not refresh this page. Showing the last loaded content.'),
                  h.button
                    .attr('type', 'button')
                    .on('click', RoutedChromeMessage.RequestedRefreshPageContent())
                    .children('Retry'),
                )
            : null,
        ),
      PersistentPlayer(h, { props: { renderMini: false } }),
    )

    return MediaPreviewBoundary(h, {
      slots: { content: site },
      onEmit: { Denied: () => undefined },
    })
  },
})

export const RoutedApplicationDefinition = Html.component({
  name: 'RoutedApplication',
  props: AppBootstrap,
  model: RoutedApplicationModel,
  message: RoutedApplicationMessage,
  restore: false,
  queries: {
    page: {
      query: GetPage,
      args: ({ props, model }) =>
        pageQueryArgs(routeUrl(model.route, props.url), model.identity, props.realm),
      onChange: () => RoutedApplicationMessage.ChangedPage(),
    },
    retainedReader: {
      query: GetPage,
      args: ({ props, model }) =>
        model.readerPath !== null && model.identity.known && model.identity.principalId === null
          ? {
              path: model.readerPath,
              identity: { ...model.identity, epoch: model.readerEpoch },
              realm: props.realm,
            }
          : undefined,
    },
    retainedSpotlight: {
      query: GetPage,
      args: ({ props, model }) => {
        if (
          model.spotlightPath === null ||
          !model.identity.known ||
          model.identity.principalId !== null
        )
          return undefined
        const source = new URL(model.spotlightPath, props.url)

        return sameSpotlightPositionPath(source, routeUrl(model.route, props.url))
          ? pageQueryArgs(source, model.identity, props.realm)
          : undefined
      },
    },
  },
})

export const RoutedApplicationNoDeps = RoutedApplicationDefinition.make({
  init: ({ props }) => ({
    route: routeFromUrl(props.url),
    identity: props.identity,
    pending: false,
    searchOpen: false,
    navigationId: 0,
    navigationAction: 'initial',
    readerPath: null,
    readerEpoch: props.identity.epoch,
    spotlightPath: null,
    readerPrincipalId: props.identity.known ? props.identity.principalId : null,
    spotifyIdentity: props.identity.known
      ? (props.identity.principalId ?? 'anonymous')
      : 'anonymous',
    membershipPrincipalId: props.identity.known ? props.identity.principalId : null,
    membershipPrincipalKnown: props.identity.known,
  }),
  subscriptions: ({ model }) => [
    routeSubscription(model.route, (route) => RoutedApplicationMessage.ChangedRoute({ route })),
  ],
  update: {
    ChangedRoute: ($, { route }) => {
      if (AppRoute.print(route) === AppRoute.print($.model.route)) return $.model

      const nextUrl = routeUrl(route, $.props.url)
      const previousUrl = routeUrl($.model.route, $.props.url)
      const parsed = parseRoute(nextUrl.pathname)
      const identity = pageIdentityForNavigation($.model.identity, nextUrl)

      const freshReader =
        previousUrl.pathname !== nextUrl.pathname &&
        PageRoute.guards.Detail(parsed) &&
        parsed.kind === 'tweets' &&
        parseCheckpoint(parsed.slug) !== null

      const nextIdentity =
        freshReader && identity.epoch === $.model.identity.epoch
          ? { ...identity, epoch: identity.epoch + 1 }
          : identity

      return $.evolve({
        route,
        identity: nextIdentity,
        pending: true,
        searchOpen: false,
        navigationId: $.model.navigationId + 1,
        navigationAction: null,
      })
        .run(startedNavigation())
        .run(ReadRouteLocation.make({ held: route, navigationId: $.model.navigationId + 1 }))
    },
    ChangedPage: ($) => {
      const result = $.queries.page
      const page = currentPageDocument(result)

      if (page) {
        const canonical = URL.parse(page.url, $.props.url)

        if (
          canonical &&
          canonical.origin === $.props.url.origin &&
          pathOf(canonical) !== AppRoute.print($.model.route)
        )
          return $.run(
            FollowPageLocation.make({
              held: $.model.route,
              url: Redacted.make(canonical),
              replace: true,
            }).pipe(Command.asNoop),
          )

        const readerPrincipalId =
          page.principalKnown === false ? $.model.readerPrincipalId : (page.principal?.id ?? null)

        let readerPath = readerPrincipalId === $.model.readerPrincipalId ? $.model.readerPath : null

        if (isReaderPageDocument(page)) readerPath = pathOf(new URL(page.url))

        const readerEpoch = isReaderPageDocument(page)
          ? $.model.identity.epoch
          : $.model.readerEpoch

        const spotlightPath =
          canonical?.origin === $.props.url.origin &&
          isPublicPageDocument(page) &&
          page.items.some((item) => item.richContent?.layout === 'spotlight')
            ? pathOf(canonical)
            : null

        const spotifyIdentity =
          page.principalKnown === false
            ? $.model.spotifyIdentity
            : (page.principal?.id ?? 'anonymous')

        const membershipPrincipalKnown = page.principalKnown ?? true
        const membershipPrincipalId = membershipPrincipalKnown ? (page.principal?.id ?? null) : null

        if ($.model.pending && $.model.navigationAction !== null)
          return $.evolve({
            pending: false,
            readerPath,
            readerEpoch,
            spotlightPath,
            readerPrincipalId,
            spotifyIdentity,
            membershipPrincipalId,
            membershipPrincipalKnown,
          }).run(completedNavigation())

        return readerPath === $.model.readerPath &&
          readerEpoch === $.model.readerEpoch &&
          spotlightPath === $.model.spotlightPath &&
          readerPrincipalId === $.model.readerPrincipalId &&
          spotifyIdentity === $.model.spotifyIdentity &&
          membershipPrincipalId === $.model.membershipPrincipalId &&
          membershipPrincipalKnown === $.model.membershipPrincipalKnown
          ? $.model
          : $.evolve({
              readerPath,
              readerEpoch,
              spotlightPath,
              readerPrincipalId,
              spotifyIdentity,
              membershipPrincipalId,
              membershipPrincipalKnown,
            })
      }

      if (!AsyncResult.isFailure(result) || result.waiting) return $.model

      const error = Option.getOrUndefined(AsyncResult.error(result))
      const redirect = error?.location ? URL.parse(error.location, $.props.url) : null

      const rollback = $.model.pending
        ? failedReaderPushReturn(
            Option.getOrUndefined(AsyncResult.value($.queries.retainedReader)),
            routeUrl($.model.route, $.props.url),
            $.model.identity,
            $.model.navigationAction,
            error,
          )
        : undefined

      if (rollback)
        return $.evolve({ pending: false })
          .run(completedNavigation())
          .run(
            FollowPageLocation.make({
              held: $.model.route,
              url: Redacted.make(rollback),
              replace: true,
            }).pipe(Command.asNoop),
          )

      const redirecting =
        error?.reason === 'redirect' &&
        redirect?.origin === $.props.url.origin &&
        pathOf(redirect) !== AppRoute.print($.model.route)

      if (error?.reason === 'identity' && $.model.identity.known) {
        const next = $.evolve({
          identity: nextIdentity($.model.identity),
          pending: true,
          searchOpen: false,
          membershipPrincipalId: null,
          membershipPrincipalKnown: false,
          readerPath: null,
          spotlightPath: null,
          readerPrincipalId: null,
          spotifyIdentity: 'anonymous',
        }).run(InvalidatePages.make({}).pipe(Command.asNoop))

        return $.model.pending ? next : next.run(startedNavigation())
      }

      if (redirecting && redirect)
        return $.run(
          FollowPageLocation.make({
            held: $.model.route,
            url: Redacted.make(redirect),
            replace: true,
          }).pipe(Command.asNoop),
        )

      return $.model.pending && $.model.navigationAction !== null
        ? $.evolve({ pending: false }).run(completedNavigation())
        : $.model
    },
    RequestedSearchNavigation: ($) => $.evolve({ searchOpen: true }),
    RequestedCloseSearch: ($) => $.evolve({ searchOpen: false }),
    ObservedRouteLocation: ($, { held, navigationId, action }) => {
      if (
        navigationId !== $.model.navigationId ||
        AppRoute.print(held) !== AppRoute.print($.model.route)
      )
        return $.model

      const result = $.queries.page
      const page = currentPageDocument(result)
      const canonical = page ? URL.parse(page.url, $.props.url) : null
      const error = Option.getOrUndefined(AsyncResult.error(result))
      const redirect = error?.location ? URL.parse(error.location, $.props.url) : null

      const redirecting =
        error?.reason === 'redirect' &&
        redirect?.origin === $.props.url.origin &&
        pathOf(redirect) !== AppRoute.print($.model.route)

      const ready =
        canonical?.origin === $.props.url.origin &&
        pathOf(canonical) === AppRoute.print($.model.route)

      const failed =
        AsyncResult.isFailure(result) &&
        !result.waiting &&
        !(error?.reason === 'identity' && $.model.identity.known) &&
        !redirecting

      const rollback =
        $.model.pending && failed
          ? failedReaderPushReturn(
              Option.getOrUndefined(AsyncResult.value($.queries.retainedReader)),
              routeUrl($.model.route, $.props.url),
              $.model.identity,
              action,
              error,
            )
          : undefined

      if (rollback)
        return $.evolve({ navigationAction: action, pending: false })
          .run(completedNavigation())
          .run(
            FollowPageLocation.make({
              held: $.model.route,
              url: Redacted.make(rollback),
              replace: true,
            }).pipe(Command.asNoop),
          )

      if ($.model.pending && (ready || failed))
        return $.evolve({ navigationAction: action, pending: false }).run(completedNavigation())

      return $.evolve({ navigationAction: action })
    },
    ChangedAuthentication: ($) => {
      const next = $.evolve({
        identity: nextIdentity($.model.identity),
        pending: true,
        searchOpen: false,
        navigationId: $.model.navigationId + 1,
        membershipPrincipalId: null,
        membershipPrincipalKnown: false,
        readerPath: null,
        spotlightPath: null,
        readerPrincipalId: null,
        spotifyIdentity: 'anonymous',
      }).run(InvalidatePages.make({}).pipe(Command.asNoop))

      return $.model.pending ? next : next.run(startedNavigation())
    },
    ClickedRetryPage: ($) => {
      const anonymousPublic =
        $.model.identity.known &&
        $.model.identity.principalId === null &&
        !isPrivatePageUrl(routeUrl($.model.route, $.props.url))

      const identity = anonymousPublic ? $.model.identity : nextIdentity($.model.identity)

      const next = $.evolve({
        identity,
        pending: true,
        searchOpen: false,
        navigationId: $.model.navigationId + 1,
      }).run(InvalidatePages.make({}).pipe(Command.asNoop))

      return $.model.pending ? next : next.run(startedNavigation())
    },
  },
  head: ({ props, model, queries }) => {
    const page = visiblePageDocument(queries.page, routeUrl(model.route, props.url), model.identity)

    if (page) {
      const url = URL.parse(page.url, props.url) ?? routeUrl(model.route, props.url)

      const metadata =
        page.metadata ?? makeStaticSiteMetadata(page.title, page.description, url.pathname)

      const head = siteHead(metadata)

      return isPrivatePageUrl(url) ||
        page.status !== 200 ||
        page.items.some((item) => item.draft) ||
        page.tweet?.post.draft
        ? [...head, HtmlHead.meta({ name: 'robots', content: 'noindex, nofollow' })]
        : head
    }

    if (
      AsyncResult.isInitial(queries.page) &&
      model.identity.epoch === props.identity.epoch &&
      AppRoute.print(model.route) === pathOf(props.url)
    )
      return isPrivatePageUrl(props.url)
        ? [
            ...siteHead(props.metadata),
            HtmlHead.meta({ name: 'robots', content: 'noindex, nofollow' }),
          ]
        : siteHead(props.metadata)

    return [
      HtmlHead.lang('en'),
      Head.title(
        AsyncResult.isFailure(queries.page)
          ? 'Page unavailable | goosebumps.fm'
          : 'Loading | goosebumps.fm',
      ),
      HtmlHead.meta({ name: 'robots', content: 'noindex, nofollow' }),
    ]
  },
  view: (h, model) => {
    const freshPage = currentPageDocument(h.queries.page)

    const spotlight = model.pending
      ? retainedSpotlightDocument(
          Option.getOrUndefined(AsyncResult.value(h.queries.retainedSpotlight)) ??
            Option.getOrUndefined(h.previous.retainedSpotlight),
          routeUrl(model.route, h.props.url),
          model.identity,
        )
      : undefined

    const page =
      visiblePageDocument(h.queries.page, routeUrl(model.route, h.props.url), model.identity) ??
      spotlight

    const principal = page?.principal ?? null
    const principalKnown = page ? (page.principalKnown ?? true) : false

    const membershipPrincipalKnown = freshPage
      ? (freshPage.principalKnown ?? true)
      : model.membershipPrincipalKnown

    const membershipPrincipalId = freshPage
      ? (freshPage.principal?.id ?? null)
      : model.membershipPrincipalId

    const url = routeUrl(model.route, h.props.url)

    const retainedReader =
      Option.getOrUndefined(AsyncResult.value(h.queries.retainedReader)) ??
      Option.getOrUndefined(h.previous.retainedReader)

    let reader = page && isReaderPageDocument(page) ? page : undefined

    if (
      reader === undefined &&
      model.identity.known &&
      model.identity.principalId === null &&
      retainedReader &&
      isPublicReaderDocument(retainedReader)
    )
      reader = retainedReader

    const readerActive = page === reader && model.navigationAction !== null && !model.pending
    const readerRoute = parseRoute(url.pathname)

    const readerPending =
      model.pending &&
      model.identity.known &&
      model.identity.principalId === null &&
      reader !== undefined &&
      isPublicReaderDocument(reader) &&
      new URL(reader.url).origin === url.origin &&
      PageRoute.guards.Detail(readerRoute) &&
      readerRoute.kind === 'tweets' &&
      parseCheckpoint(readerRoute.slug) !== null

    const readerPrincipalId =
      page && page.principalKnown !== false ? (page.principal?.id ?? null) : model.readerPrincipalId

    let readerUrl = reader ? URL.parse(reader.url, h.props.url) : null

    if (readerUrl === null && readerPrincipalId === model.readerPrincipalId && model.readerPath)
      readerUrl = URL.parse(model.readerPath, h.props.url)

    const neighbourPages = readerNeighbourPageArgs(
      !model.pending &&
        model.navigationAction !== null &&
        freshPage &&
        isPublicReaderDocument(freshPage)
        ? freshPage
        : undefined,
      url,
      model.identity,
      h.props.realm,
    )

    return SpotifyProvider(h, {
      props: {
        identity:
          page && page.principalKnown !== false
            ? (principal?.id ?? 'anonymous')
            : model.spotifyIdentity,
      },
      view: () =>
        PlayerProvider(h, {
          props: { principalId: principal?.id ?? null, principalKnown, returnTo: pathOf(url) },
          view: () =>
            MembershipProvider(h, {
              props: {
                principalId: membershipPrincipalKnown ? membershipPrincipalId : null,
                principalKnown: membershipPrincipalKnown,
                lifecycle: {
                  navigationId: model.navigationId,
                  pending: freshPage === undefined || model.pending,
                },
              },
              onEmit: {
                RequestedPrincipalRefresh: () => RoutedApplicationMessage.ChangedAuthentication(),
              },
              view: () =>
                RoutedChrome(h, {
                  props: {
                    url,
                    realm: h.props.realm,
                    epoch: model.identity.epoch,
                    page: page ?? null,
                    reader: reader ?? null,
                    readerUrl,
                    readerPrincipalId,
                    dashboardPrincipalId: membershipPrincipalKnown ? membershipPrincipalId : null,
                    readerActive,
                    readerPending,
                    spotlightPending: spotlight !== undefined,
                    readerPrefetchPages: neighbourPages,
                    navigationId: model.navigationId,
                    navigationAction: model.navigationAction,
                    pending: model.pending,
                    failed: AsyncResult.isFailure(h.queries.page),
                    searchOpen: model.searchOpen,
                  },
                  onEmit: {
                    RequestedSearch: () => RoutedApplicationMessage.RequestedSearchNavigation(),
                    RequestedCloseSearch: () => RoutedApplicationMessage.RequestedCloseSearch(),
                    RequestedRefresh: () => RoutedApplicationMessage.ClickedRetryPage(),
                  },
                }),
            }),
        }),
    })
  },
})

export const RoutedApplication = RoutedApplicationNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(
      ReportNavigation.layer,
      InvalidatePages.layer,
      FollowPageLocation.layer,
      ReadRouteLocation.layer,
      membershipCommandsLayer,
      spotifyCommandsLayer,
    ),
  ),
)
