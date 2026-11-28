import { Command, Route, Router } from '@effect/ui'
import { Effect, Option, Schema } from 'effect'

import { isSpotifyCallbackUrl } from '../features/spotify/callback-url'
import { isServerPath, parseRoute, Route as PageRoute } from '../route'

const search = {
  at: Schema.optional(Schema.Array(Schema.String)),
  q: Schema.optional(Schema.Array(Schema.String)),
  edit: Schema.optional(Schema.Array(Schema.String)),
  layout: Schema.optional(Schema.Array(Schema.String)),
  returnTo: Schema.optional(Schema.Array(Schema.String)),
  token: Schema.optional(Schema.Array(Schema.String)),
  error: Schema.optional(Schema.Array(Schema.String)),
  verified: Schema.optional(Schema.Array(Schema.String)),
  email: Schema.optional(Schema.Array(Schema.String)),
  name: Schema.optional(Schema.Array(Schema.String)),
  reset: Schema.optional(Schema.Array(Schema.String)),
  sent: Schema.optional(Schema.Array(Schema.String)),
  complete: Schema.optional(Schema.Array(Schema.String)),
  show: Schema.optional(Schema.Array(Schema.String)),
  search: Schema.optional(Schema.Array(Schema.String)),
  searchValue: Schema.optional(Schema.Array(Schema.String)),
  offset: Schema.optional(Schema.Array(Schema.String)),
  limit: Schema.optional(Schema.Array(Schema.String)),
  notice: Schema.optional(Schema.Array(Schema.String)),
  collection: Schema.optional(Schema.Array(Schema.String)),
  status: Schema.optional(Schema.Array(Schema.String)),
  mix: Schema.optional(Schema.Array(Schema.String)),
  saved: Schema.optional(Schema.Array(Schema.String)),
  import: Schema.optional(Schema.Array(Schema.String)),
  visit: Schema.optional(Schema.Array(Schema.String)),
  code: Schema.optional(Schema.Array(Schema.String)),
  state: Schema.optional(Schema.Array(Schema.String)),
}

const href = Schema.optional(Schema.String)

const routes = Route.union({
  Home: Route.make('/', { params: { href }, search }),
  Dashboard: Route.make('/dashboard/*', { params: { href }, search }),
  Pair: Route.make('/:first/:second', {
    params: { first: Schema.String, second: Schema.String, href },
    search,
  }),
  Single: Route.make('/:first', { params: { first: Schema.String, href }, search }),
  NotFound: Route.make('/*', { params: { href }, search }),
})

const nativeResolve = routes.resolve

const nativePrint = routes.print

const nativePrintPath = routes.printPath

const withHref = <R extends typeof routes.Type>(route: R, href: string): R => ({
  ...route,
  params: { ...route.params, href },
})

const resolve = (href: string): Option.Option<Route.Resolved<typeof routes.Type>> => {
  const url = URL.parse(href, 'http://gbfm.invalid')

  if (url === null || url.origin !== 'http://gbfm.invalid' || !isPageUrl(url)) return Option.none()

  const resolved = Option.getOrElse(nativeResolve(`${url.pathname}${url.search}`), () => ({
    route: routes.NotFound({ params: { '*': url.pathname.slice(1) } }),
    redirected: false,
    notFound: true,
    invalid: [],
  }))

  return Option.some({
    ...resolved,
    redirected: false,
    notFound: PageRoute.guards.NotFound(parseRoute(url.pathname)),
    route: withHref(resolved.route, `${url.pathname}${url.search}`),
  })
}

export const AppRoute = Object.assign(routes, {
  resolve,
  parse: (href: string) => Option.map(resolve(href), (resolved) => resolved.route),
  print: (route: typeof routes.Type) => route.params.href ?? nativePrint(route),
  printPath: (route: typeof routes.Type) =>
    route.params.href === undefined
      ? nativePrintPath(route)
      : new URL(route.params.href, 'http://gbfm.invalid').pathname,
})

export type AppRoute = typeof AppRoute.Type

export const routeFromUrl = (url: URL): AppRoute =>
  Option.getOrElse(AppRoute.parse(`${url.pathname}${url.search}`), () =>
    AppRoute.NotFound({
      params: { '*': url.pathname.slice(1), href: `${url.pathname}${url.search}` },
    }),
  )

export const pageRoute = (route: AppRoute) => parseRoute(AppRoute.printPath(route))

export const routeUrl = (route: AppRoute, origin: URL) => new URL(AppRoute.print(route), origin)

export const routeSubscription = <Message>(held: AppRoute, changed: (route: AppRoute) => Message) =>
  Router.subscription(AppRoute, held, changed)

export const patchPageSearch = (
  router: Router.Router,
  held: AppRoute,
  patch: Readonly<Record<string, ReadonlyArray<string> | null>>,
  history: 'push' | 'replace' = 'replace',
): Effect.Effect<Router.PatchOutcome> => {
  const current = router.location()
  const url = new URL(current.url, 'http://gbfm.invalid')

  if (url.pathname !== AppRoute.printPath(held)) return Effect.succeed('stale')

  for (const [key, value] of Object.entries(patch)) {
    url.searchParams.delete(key)

    if (value === null) continue

    for (const item of value) url.searchParams.append(key, item)
  }

  return router.navigate(`${url.pathname}${url.search}${current.hash}`, {
    replace: history === 'replace',
  })
}

export class PatchPageSearch extends Command.Service<PatchPageSearch>()('gbfm/PatchPageSearch', {
  args: {
    held: AppRoute,
    patch: Schema.Record(Schema.String, Schema.NullOr(Schema.Array(Schema.String))),
    history: Schema.Literals(['push', 'replace']),
  },
  success: Router.PatchOutcome,
}) {
  static readonly layer = this.toLayer(
    Effect.map(
      Router.Router,
      (router) =>
        ({ held, patch, history }) =>
          patchPageSearch(router, held, patch, history),
    ),
  )
}

export const isPageUrl = (url: URL) =>
  !isServerPath(url.pathname) &&
  !url.pathname.startsWith('/actions/') &&
  !url.pathname.startsWith('/connect/') &&
  !url.pathname.startsWith('/telemetry/') &&
  !url.pathname.startsWith('/social/') &&
  url.pathname !== '/mcp.txt' &&
  !isSpotifyCallbackUrl(url) &&
  !(url.pathname === '/auth/verify-email' && url.searchParams.has('token')) &&
  !(url.pathname === '/auth/reset-password' && url.searchParams.has('token')) &&
  !(
    (url.pathname === '/subscribe' || url.pathname === '/unsubscribe') &&
    url.searchParams.has('token')
  ) &&
  !(url.pathname.startsWith('/auth/') && !PageRoute.guards.Auth(parseRoute(url.pathname)))

export const isPrivatePageUrl = (url: URL) => {
  const route = parseRoute(url.pathname)

  return (
    PageRoute.guards.Dashboard(route) ||
    PageRoute.guards.Composer(route) ||
    PageRoute.guards.Auth(route) ||
    url.pathname === '/listening' ||
    url.pathname === '/spotify/callback'
  )
}

export const canPrefetchPage = (
  url: URL,
  identity?: { readonly known: boolean; readonly principalId: string | null },
) =>
  isPageUrl(url) &&
  !isPrivatePageUrl(url) &&
  identity?.known === true &&
  identity.principalId === null
