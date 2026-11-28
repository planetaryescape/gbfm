import { UiSchema, type View } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { PageDocument } from '../domain/page'
import { staticPages } from '../domain/static/pages'
import { AuthPage, safeAuthPageProps } from '../features/account/auth-page'
import { PublicContentPage } from '../features/content'
import { CreatorPage } from '../features/creator/CreatorPage'
import { DashboardPage } from '../features/dashboard'
import { emptyDocument } from '../features/dashboard/document'
import { isDocumentlessDashboardSection } from '../features/dashboard/page-contract'
import { sectionFromUrl } from '../features/dashboard/sections'
import { InvitationPage } from '../features/invitation/page'
import { ListeningPage } from '../features/listening/page'
import { NewsletterPage, safeNewsletterPageProps } from '../features/newsletter/page'
import { ReaderPage } from '../features/reader'
import { parseRoute, Route } from '../route'
import { richContentView } from '../ui/rich-content/render'
import { StaticPage } from './static-page'

export const PageContentProps = Schema.Struct({
  page: PageDocument,
  navigationId: Schema.optionalKey(Schema.Number),
  navigationAction: Schema.optionalKey(Schema.Literals(['initial', 'push', 'replace', 'pop'])),
  active: Schema.optionalKey(Schema.Boolean),
})

export const PageContentEvents = UiSchema.TaggedEnum({
  RequestedRefresh: {},
})

export const PageContentMessage = UiSchema.TaggedEnum({
  RequestedRefresh: {},
})

type PageContentMessage = typeof PageContentMessage.Type

export const ReaderContentProps = Schema.Struct({
  page: Schema.NullOr(PageDocument),
  url: Schema.URL,
  principalId: Schema.NullOr(Schema.String),
  navigationId: Schema.Number,
  navigationAction: Schema.Literals(['initial', 'push', 'replace', 'pop']),
  active: Schema.Boolean,
  visible: Schema.optionalKey(Schema.Boolean),
})

export const ReaderContent = Html.component({
  name: 'ReaderContent',
  props: ReaderContentProps,
  model: Schema.Null,
  message: PageContentMessage,
  events: PageContentEvents,
  restore: false,
}).make({
  init: () => null,
  update: {
    RequestedRefresh: ($) => $.emit(PageContentEvents.RequestedRefresh()),
  },
  view: (h) => {
    const page = h.props.page
    const url = page ? (URL.parse(page.url, h.props.url) ?? h.props.url) : h.props.url
    let principal = page?.principal ?? null

    if (page === null && h.props.principalId !== null)
      principal = { id: h.props.principalId, name: null, username: null, role: null }

    const failure =
      page?.failure ?? (page && page.status >= 500 ? 'This page could not be loaded.' : null)

    const retry = () => PageContentMessage.RequestedRefresh()

    return h.div.class('contents').children(
      h.props.active &&
        failure &&
        page?.tweet &&
        h.aside.class('page').attr('role', 'alert').children(failure),
      ReaderPage(h, {
        key: `reader:${h.props.principalId ?? 'anonymous'}`,
        props: {
          url,
          principal,
          principalKnown: page ? (page.principalKnown ?? true) : false,
          screen: page?.tweet ?? null,
          neighbours: page?.neighbours ?? null,
          posts: page?.items ?? [],
          renderedAt: page?.renderedAt ?? 0,
          failure: page?.failure ?? null,
          status: page?.status ?? 503,
          navigationId: h.props.navigationId,
          navigationAction: h.props.navigationAction,
          active: h.props.active && page !== null,
          visible: h.props.visible ?? h.props.active,
        },
      }),
      h.props.active &&
        failure &&
        h.div
          .class('page')
          .children(
            h.a
              .attr('href', `${url.pathname}${url.search}`)
              .class('btn')
              .on('click', retry(), { preventDefault: true })
              .children('Retry loading this page'),
          ),
    )
  },
})

export const PageContent = Html.component({
  name: 'PageContent',
  props: PageContentProps,
  model: Schema.Null,
  message: PageContentMessage,
  events: PageContentEvents,
}).make({
  init: () => null,
  update: {
    RequestedRefresh: ($) => $.emit(PageContentEvents.RequestedRefresh()),
  },
  view: (h) => {
    const page = h.props.page
    const url = URL.parse(page.url, 'https://goosebumps.fm')

    const retry = (href: string) =>
      h.a
        .attr('href', href)
        .class('btn')
        .on('click', PageContentMessage.RequestedRefresh(), { preventDefault: true })
        .children('Retry loading this page')

    const unavailable = (title: string, message: string, href: string) =>
      h.section
        .class('page')
        .children(h.h1.children(title), h.p.attr('role', 'alert').children(message), retry(href))

    const notFound = () =>
      h.section
        .class('page')
        .children(h.h1.children('Page not found'), h.a.attr('href', '/').children('Return home'))

    if (!url || !['https:', 'http:'].includes(url.protocol))
      return unavailable('Page unavailable', 'The page address could not be read.', '/')

    const route = parseRoute(url.pathname)
    const href = `${url.pathname}${url.search}`
    const document = { ...page, url: url.href }
    const failure = page.failure ?? (page.status >= 500 ? 'This page could not be loaded.' : null)

    const withFailure = <R>(content: View.Content<PageContentMessage, R>, reportsFailure = false) =>
      h.div
        .class('contents')
        .children(
          failure &&
            !reportsFailure &&
            h.aside.class('page').attr('role', 'alert').children(failure),
          content,
          failure && h.div.class('page').children(retry(href)),
        )

    const publicContent = () =>
      withFailure(
        PublicContentPage(h, { props: { document } }),
        page.failure !== null && page.shows === null && page.profile === null,
      )

    const reader = () =>
      ReaderContent(h, {
        key: `reader:${page.principal?.id ?? 'anonymous'}`,
        props: {
          page,
          url,
          principalId: page.principal?.id ?? null,
          navigationId: h.props.navigationId ?? 0,
          navigationAction: h.props.navigationAction ?? 'initial',
          active: h.props.active ?? true,
        },
        onEmit: { RequestedRefresh: () => PageContentMessage.RequestedRefresh() },
      })

    const auth = (action: string, location = url.href) =>
      withFailure(
        AuthPage(h, {
          key: `auth:${action}`,
          props: safeAuthPageProps({
            action,
            url: location,
            turnstileSiteKey: page.turnstileSiteKey,
          }),
        }),
      )

    const signIn = () => {
      const target = new URL('/auth/sign-in', url)
      target.searchParams.set('returnTo', href)

      return auth('sign-in', target.href)
    }

    const dashboard = (location = url.href) => {
      if (page.principalKnown === false)
        return unavailable(
          'Your dashboard',
          'Your account could not be verified. Try loading this page again.',
          href,
        )

      if (!page.principal) return signIn()

      const verifiedCurrentPrincipal = page.principalKnown === true ? page.principal : null
      const dashboardUrl = new URL(location)

      const dashboardDocument =
        page.dashboard ??
        (verifiedCurrentPrincipal &&
        page.status === 200 &&
        page.failure === null &&
        isDocumentlessDashboardSection(sectionFromUrl(location), dashboardUrl.searchParams)
          ? emptyDocument
          : null)

      if (!dashboardDocument)
        return unavailable('Your dashboard', failure ?? 'Dashboard data is unavailable.', href)

      return withFailure(
        DashboardPage(h, {
          key: `dashboard:${page.principal.id}`,
          props: { url: location, principal: page.principal, document: dashboardDocument },
        }),
      )
    }

    const readerDetail = Route.guards.Detail(route) && route.kind === 'tweets'

    if (page.status === 404 && !readerDetail) return notFound()

    if (page.listening)
      return withFailure(
        ListeningPage(h, {
          key: `listening:${page.principal?.id ?? 'anonymous'}`,
          props: { document: page.listening, url: url.href, principal: page.principal },
        }),
      )

    if (page.shows) return publicContent()

    return Route.match(route, {
      Home: publicContent,
      Listing: ({ kind }) => (kind === 'tweets' ? reader() : publicContent()),
      Detail: ({ kind }) => (kind === 'tweets' ? reader() : publicContent()),
      Auth: ({ action }) => auth(action),
      Composer: () => {
        if (!page.principal) return signIn()

        return withFailure(
          CreatorPage(h, {
            key: `creator:${page.principal.id}:${url.pathname}:${url.searchParams.get('edit') ?? ''}`,
            props: { url: url.href, principal: page.principal },
          }),
        )
      },
      Dashboard: ({ section }) =>
        dashboard(
          url.pathname === '/reminders'
            ? new URL(`/dashboard/${section}${url.search}`, url).href
            : url.href,
        ),
      Static: ({ page: name }) => {
        if (name === 'invite/charlie3000')
          return withFailure(InvitationPage(h, { key: 'invitation' }))

        if (name === 'spotify-callback')
          return dashboard(new URL(`/dashboard/spotify-callback${url.search}`, url).href)

        if (name === 'subscribe' || name === 'unsubscribe')
          return withFailure(
            NewsletterPage(h, {
              key: `newsletter:${name}`,
              props: safeNewsletterPageProps({
                mode: name,
                url: url.href,
                turnstileSiteKey: page.turnstileSiteKey,
              }),
            }),
          )

        if (name === 'listening')
          return unavailable(
            'Your listening pile',
            failure ?? 'Listening data is unavailable.',
            href,
          )

        if (name === 'changelog')
          return withFailure(
            h.article
              .class(
                'page prose prose-headings:text-foreground prose-p:text-foreground/80 prose-li:text-foreground/80 prose-a:text-foreground prose-a:hover:text-highlight prose-strong:text-foreground marker:text-muted-foreground',
              )
              .children(
                h.h1.children(page.title),
                (staticPages.get(name)?.paragraphs ?? []).map((text) =>
                  h.p.class('content-paragraph').children(text),
                ),
                page.changelog && richContentView(h, page.changelog),
              ),
          )

        return withFailure(StaticPage(h, { key: name, props: { page: name, title: page.title } }))
      },
      NotFound: notFound,
    })
  },
})
