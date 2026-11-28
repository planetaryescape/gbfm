import type { View } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import type { Html } from '@effect/ui/html'
import { canCreatePosts } from '@gbfm/core/roles'

import { signInHref } from '../../page/auth/links'
import { iconPaths, lucide } from '../../ui/icons'
import { NavigationMessage, type NavigationModel, type StationNavigationProps } from './domain'
import { TrackMenuDrag } from './gestures'
import { isActiveNavLink, navigationPathname, visibleNavigationLinks } from './links'

const browseIcons = new Map([
  ['/shows', iconPaths.radio],
  ['/editorial', iconPaths.editorial],
  ['/tweets', iconPaths.message],
  ['/labels', iconPaths.album],
])

export const mobileMenu = (
  h: Html.H<NavigationMessage>,
  model: NavigationModel,
  props: StationNavigationProps,
  appearance: View.Content<NavigationMessage>,
) => {
  const pathname = navigationPathname(props.url)
  const principal = props.principal
  const icon = (path: string) => lucide(h, path, 'menu-sheet-icon')

  const link = (href: string, label: string, path: string) =>
    h.a
      .attr('href', href)
      .attr('aria-current', isActiveNavLink(pathname, href) ? 'page' : undefined)
      .on('click', NavigationMessage.ClosedMenu())
      .children(icon(path), label)

  const section = (heading: string, items: View.Children<NavigationMessage, never>) =>
    h.section.class('menu-sheet-section').children(h.h3.children(heading), items)

  return Dialog(h, {
    key: 'station-mobile-menu',
    props: {
      id: 'mobile-menu',
      open: model.menuOpen,
      openMethod: model.menuOpenMethod ?? undefined,
      triggerId: 'station-menu-trigger',
      keepMounted: true,
      modal: true,
    },
    onEmit: {
      RequestedOpen: () =>
        NavigationMessage.OpenedMenu({ method: model.menuOpenMethod ?? 'keyboard' }),
      RequestedClose: () => NavigationMessage.ClosedMenu(),
      Settled: ({ open }) => NavigationMessage.SettledMenu({ open }),
    },
    view: (dialog) =>
      h.div.class('contents').children(
        dialog.portal(h.dialog.class('mobile-menu-dialog'))?.children(
          dialog.backdrop(h.div.class('mobile-menu-backdrop').style({ position: 'fixed' })),
          dialog
            .popup(
              h.div
                .class('menu-sheet')
                .style({ '--player-drag-y': `${model.menuOffset}px` })
                .attr('data-dragging', model.menuDrag ? '' : undefined),
            )
            .children(
              dialog
                .initialFocus(dialog.title(h.h2.class('sr-only').attr('tabindex', '-1')))
                .children('Menu'),
              h.header
                .class('player-drag-surface')
                .onMount(TrackMenuDrag({ active: model.menuOpen && model.menuSettled }))
                .children(
                  h.span.class('player-drag-grip').attr('aria-hidden', 'true'),
                  dialog
                    .close(h.button.attr('type', 'button').class('sr-only'))
                    .children('Close menu'),
                ),
              h.nav
                .class('menu-sheet-links')
                .attr('aria-label', 'Menu links')
                .children(
                  section('Browse', [
                    link('/', 'Home', iconPaths.home),
                    ...visibleNavigationLinks(principal).flatMap(([href, label]) =>
                      href === '/about'
                        ? []
                        : [link(href, label, browseIcons.get(href) ?? iconPaths.link)],
                    ),
                    link('/mixes', 'Mixes', iconPaths.disc),
                    link('/subscribe', 'Subscribe', iconPaths.mail),
                    link('/about', 'About', iconPaths.info),
                  ]),
                  canCreatePosts(principal?.role ?? null) &&
                    section('Create', [
                      link('/new', 'New post', iconPaths.edit),
                      link('/mix-upload', 'New mix', iconPaths.upload),
                      link('/dashboard/content', 'My content', iconPaths.list),
                    ]),
                  section('Follow', [
                    link('/rss.xml', 'Mixes via RSS', iconPaths.rss),
                    link(
                      'https://youtube.com/@goosebumpsfm',
                      'Mixes via YouTube',
                      iconPaths.youtube,
                    ),
                  ]),
                  section('Account', [
                    appearance,
                    principal
                      ? link('/dashboard', 'Dashboard', iconPaths.dashboard)
                      : link(signInHref(pathname), 'Log in', iconPaths.logIn),
                    principal &&
                      h.form
                        .attr('method', 'post')
                        .attr('action', '/actions/sign-out')
                        .children(
                          h.button
                            .attr('type', 'submit')
                            .children(icon(iconPaths.logOut), 'Sign out'),
                        ),
                  ]),
                ),
            ),
        ),
      ),
  })
}
