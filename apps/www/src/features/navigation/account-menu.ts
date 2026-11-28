import type { View } from '@effect/ui'
import { Popover } from '@effect/ui-kit'
import { Html } from '@effect/ui/html'
import { canCreatePosts } from '@gbfm/core/roles'

import type { Principal } from '../../domain/principal'
import { imageSource } from '../../ui/artwork'
import { NavigationMessage } from './domain'

const rowClass =
  'flex min-h-10 w-full items-center rounded-sm px-3 py-2 text-left text-sm text-popover-foreground no-underline transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export const AccountFirst = Html.ref('StationNavigation.accountFirst', 'a')

const accountTriggerId = 'station-account-trigger'

export const accountMenu = (
  h: Html.H<NavigationMessage>,
  principal: Principal,
  open: boolean,
  interactive: boolean,
) => {
  const name = principal.name ?? principal.username ?? '?'

  const item = (href: string, label: string): View.Content<NavigationMessage> =>
    h.a.attr('href', href).class(rowClass).children(label)

  return Popover(h, {
    key: 'station-account',
    props: {
      open,
      triggerId: accountTriggerId,
      side: 'top',
      align: 'end',
      sideOffset: 12,
      collisionPadding: 16,
      positionMethod: 'fixed',
      keepMounted: true,
      initialFocus: false,
      topLayer: false,
    },
    onEmit: {
      RequestedOpen: () => NavigationMessage.OpenedAccount(),
      RequestedClose: () => NavigationMessage.ClosedAccount(),
      Settled: ({ open }) => NavigationMessage.SettledAccount({ open }),
    },
    view: (popover) =>
      h.div.class('relative').children(
        popover
          .trigger({
            disabled: !interactive,
            element: h.button
              .id(accountTriggerId)
              .attr('type', 'button')
              .attr('title', name)
              .attr('aria-label', 'Account menu')
              .disabled(!interactive)
              .class(
                'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted p-0 text-xs font-bold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              ),
          })
          .children(
            principal.image
              ? imageSource(h, principal.image).attr('alt', '').class('size-full object-cover')
              : (name[0] ?? '?'),
          ),
        popover.portal(h.dialog)?.children(
          popover.backdrop(h.div.class('account-menu-backdrop').style({ pointerEvents: 'none' })),
          popover.positioner(h.div).children(
            popover.popup(h.div).children(
              h.nav
                .attr('aria-label', 'Account')
                .class('account-menu')
                .children(
                  h.div
                    .class('border-b border-border px-3 py-2')
                    .children(
                      popover.title(h.h2.class('truncate text-base font-semibold')).children(name),
                      principal.username &&
                        h.p
                          .class('truncate text-xs text-muted-foreground')
                          .children(`@${principal.username}`),
                    ),
                  h.div
                    .class('py-1')
                    .children(
                      h.a
                        .ref(AccountFirst)
                        .attr('href', '/dashboard')
                        .class(rowClass)
                        .children('Dashboard'),
                      item('/listening', 'Listening pile'),
                      item('/dashboard/profile', 'Edit profile'),
                    ),
                  canCreatePosts(principal.role) &&
                    h.div
                      .class('border-t border-border py-1')
                      .children(
                        item('/new', 'New post'),
                        item('/mix-upload', 'New mix'),
                        item('/dashboard/content', 'My content'),
                      ),
                  h.form
                    .attr('method', 'post')
                    .attr('action', '/actions/sign-out')
                    .class('border-t border-border pt-1')
                    .children(
                      h.button
                        .attr('type', 'submit')
                        .class(`${rowClass} border-0 bg-transparent`)
                        .children('Log out'),
                    ),
                ),
            ),
          ),
        ),
      ),
  })
}
