import { Component, Subscription } from '@effect/ui'
import { Html, HtmlCommand } from '@effect/ui/html'
import { Stream } from 'effect'

import { ThemeControls } from '../../app/theme-button'
import { signInHref } from '../../page/auth/links'
import { iconPaths, lucide } from '../../ui/icons'
import { wordmark } from '../../ui/wordmark'
import { AccountFirst, accountMenu } from './account-menu'
import {
  NavigationEvents,
  NavigationMessage,
  NavigationModel,
  StationNavigationProps,
} from './domain'
import { NavigationReady } from './gestures'
import {
  dragOffset,
  isActiveNavLink,
  navigationPathname,
  navigationLinks,
  shouldDismiss,
  visibleNavigationLinks,
} from './links'
import { MobileDock } from './mobile-dock'
import { mobileMenu } from './mobile-menu'
import { DesktopNowPlaying } from './now-playing'
import { navigationStyles } from './styles'

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const desktopLinkClass = `inline-flex h-11 shrink-0 items-center rounded-sm px-2.5 text-xs font-semibold tracking-wide no-underline transition-colors text-muted-foreground hover:bg-muted/60 hover:text-foreground aria-[current=page]:text-foreground ${focusRing}`

export const StationNavigation = Html.component({
  name: 'StationNavigation',
  props: StationNavigationProps,
  model: NavigationModel,
  message: NavigationMessage,
  events: NavigationEvents,
  restore: false,
}).make({
  init: ({ props }) => ({
    url: props.url,
    principalId: props.principal?.id ?? null,
    collectionsVisible: props.principal?.role === 'admin',
    interactive: false,
    menuOpen: false,
    menuOpenMethod: null,
    menuSettled: true,
    accountOpen: false,
    accountSettled: true,
    minimized: false,
    menuDrag: null,
    menuOffset: 0,
  }),
  subscriptions: ({ props }) => [
    Subscription.make('navigation-location', [props.url, props.principal?.id ?? null], () =>
      Stream.make(
        NavigationMessage.ChangedLocation({
          url: props.url,
          principalId: props.principal?.id ?? null,
        }),
      ),
    ),
    props.principalKnown &&
      Subscription.make('navigation-collections', [props.principal?.role ?? null], () =>
        Stream.make(
          NavigationMessage.ChangedCollectionsVisibility({
            visible: props.principal?.role === 'admin',
          }),
        ),
      ),
  ],
  update: {
    Ready: ($) => $.evolve({ interactive: true }),
    ChangedCollectionsVisibility: ($, { visible }) => $.evolve({ collectionsVisible: visible }),
    ChangedLocation: ($, { url, principalId }) => {
      if ($.model.url === url && $.model.principalId === principalId) return $.model

      return $.evolve({
        url,
        principalId,
        menuOpen: false,
        menuOpenMethod: null,
        accountOpen: false,
        menuDrag: null,
        menuOffset: 0,
        minimized: false,
      })
    },
    RequestedSearch: ($) =>
      $.model.interactive
        ? $.evolve({ menuOpen: false, accountOpen: false, menuDrag: null, menuOffset: 0 }).emit(
            NavigationEvents.RequestedSearch(),
          )
        : $.model,
    OpenedMenu: ($, { method }) => {
      if (!$.model.interactive) return $.model

      if ($.model.menuOpen) return $.evolve({ menuOpen: false, menuDrag: null })

      return $.evolve({
        menuOpen: true,
        menuOpenMethod: method,
        menuSettled: false,
        menuDrag: null,
        menuOffset: 0,
        accountOpen: false,
      })
    },
    ClosedMenu: ($) => $.evolve({ menuOpen: false, menuDrag: null }),
    SettledMenu: ($, { open }) => {
      if (open !== $.model.menuOpen) return $.model

      return $.evolve({ menuSettled: true, menuDrag: null, menuOffset: 0 })
    },
    OpenedAccount: ($) =>
      $.model.interactive && $.props.principal && $.props.principalKnown
        ? $.evolve({
            accountOpen: !$.model.accountOpen,
            accountSettled: false,
            menuOpen: false,
            menuDrag: null,
            menuOffset: 0,
          })
        : $.model,
    ClosedAccount: ($) => $.evolve({ accountOpen: false }),
    SettledAccount: ($, { open }) =>
      open && $.model.accountOpen && !$.model.accountSettled
        ? $.evolve({ accountSettled: true }).run(
            HtmlCommand.focus(AccountFirst, () => Component.noop, { preventScroll: true }),
          )
        : $.model,
    ChangedMinimized: ($, { minimized }) => $.evolve({ minimized }),
    StartedMenuDrag: ($, { pointerId, clientY }) => {
      if (!$.model.menuOpen || !$.model.menuSettled || $.model.menuDrag) return $.model

      return $.evolve({ menuDrag: { pointerId, startY: clientY - $.model.menuOffset } })
    },
    MovedMenuDrag: ($, { pointerId, clientY }) =>
      $.model.menuDrag?.pointerId === pointerId
        ? $.evolve({ menuOffset: dragOffset($.model.menuDrag, clientY) })
        : $.model,
    ReleasedMenuDrag: ($, { pointerId, clientY, viewportHeight }) => {
      if ($.model.menuDrag?.pointerId !== pointerId) return $.model
      const offset = dragOffset($.model.menuDrag, clientY)

      if (shouldDismiss(offset, viewportHeight))
        return $.evolve({ menuOpen: false, menuDrag: null, menuOffset: offset })

      return $.evolve({ menuDrag: null, menuOffset: 0 })
    },
    CancelledMenuDrag: ($) => $.evolve({ menuDrag: null, menuOffset: 0 }),
  },
  view: (h, model) => {
    const { principal } = h.props
    const pathname = navigationPathname(h.props.url)
    const links = visibleNavigationLinks(principal)

    const navLink = (href: string, label: string) =>
      h.a
        .key(href)
        .attr('href', href)
        .class(desktopLinkClass)
        .attr('aria-current', isActiveNavLink(pathname, href) ? 'page' : undefined)
        .children(label)

    const account = () => {
      if (!h.props.principalKnown)
        return h.span
          .attr('role', 'status')
          .attr('aria-label', 'Checking account')
          .class('size-8 bg-muted motion-safe:animate-pulse')

      if (principal) return accountMenu(h, principal, model.accountOpen, model.interactive)

      return h.a
        .attr('href', signInHref(pathname))
        .class(
          `inline-flex h-8 shrink-0 items-center rounded-sm px-2 text-xs font-semibold text-highlight no-underline transition-colors hover:bg-muted/60 ${focusRing}`,
        )
        .children('Log in')
    }

    return ThemeControls(h, {
      view: (themeControls) =>
        h.div
          .class('station-navigation')
          .attr('data-interactive', String(model.interactive))
          .onMount(NavigationReady())
          .children(
            h.el('style').children(navigationStyles),
            h.div
              .class(
                'station-desktop fixed inset-x-0 bottom-0 z-40 hidden h-12 shrink-0 items-center gap-4 border-t-2 border-foreground bg-background/95 pl-4 pr-6 backdrop-blur lg:flex',
              )
              .children(
                h.a
                  .attr('href', '/')
                  .attr('aria-label', 'goosebumps.fm home')
                  .class(
                    'group flex shrink-0 items-center text-foreground no-underline transition-colors hover:text-highlight',
                  )
                  .children(wordmark(h)),
                h.nav
                  .attr('aria-label', 'Primary')
                  .class('flex shrink-0 items-center gap-1')
                  .children(
                    navigationLinks.map(([href, label]) => {
                      if (href !== '/collections' || principal?.role === 'admin')
                        return navLink(href, label)

                      if (!h.props.principalKnown && model.collectionsVisible)
                        return h.span
                          .key(href)
                          .attr('aria-hidden', 'true')
                          .class(`${desktopLinkClass} invisible`)
                          .children(label)

                      return null
                    }),
                  ),
                h.button
                  .attr('type', 'button')
                  .attr('aria-label', 'Search')
                  .disabled(!model.interactive)
                  .on('click', NavigationMessage.RequestedSearch())
                  .class(
                    `btn btn-quiet btn-icon shrink-0 ${focusRing} border-0 bg-transparent text-muted-foreground hover:text-foreground`,
                  )
                  .children(lucide(h, iconPaths.search, 'h-4 w-4')),
                h.div.class('min-w-0 flex-1'),
                h.div
                  .class('flex shrink-0 items-center gap-3')
                  .children(
                    DesktopNowPlaying(h, { key: 'station-now-playing' }),
                    h.div
                      .class('flex h-11 w-14 shrink-0 items-center justify-end')
                      .children(account()),
                  ),
              ),
            MobileDock(h, {
              key: 'station-mobile-dock',
              props: {
                pathname,
                interactive: model.interactive,
                menuOpen: model.menuOpen,
                minimized: model.minimized,
              },
              onEmit: {
                RequestedSearch: () => NavigationMessage.RequestedSearch(),
                RequestedMenu: ({ method }) => NavigationMessage.OpenedMenu({ method }),
                ChangedMinimized: ({ minimized }) =>
                  NavigationMessage.ChangedMinimized({ minimized }),
              },
            }),
            mobileMenu(
              h,
              model,
              h.props,
              themeControls.button(h.button).children(themeControls.label),
            ),
            h.nav
              .class('station-fallback flex-wrap items-center gap-2 border-b border-border p-3')
              .attr('aria-label', 'Navigation without JavaScript')
              .children(
                navLink('/', 'Home'),
                links.map(([href, label]) => navLink(href, label)),
                navLink('/mixes', 'Mixes'),
                navLink('/subscribe', 'Subscribe'),
                h.props.principalKnown &&
                  (principal
                    ? navLink('/dashboard', 'Dashboard')
                    : navLink(signInHref(pathname), 'Log in')),
                principal &&
                  h.form
                    .attr('method', 'post')
                    .attr('action', '/actions/sign-out')
                    .children(
                      h.button.attr('type', 'submit').class('btn btn-quiet').children('Log out'),
                    ),
              ),
          ),
    })
  },
})
