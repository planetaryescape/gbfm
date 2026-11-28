import { UiSchema } from '@effect/ui'
import { Popover } from '@effect/ui-kit'
import { Html } from '@effect/ui/html'
import { canCreatePosts } from '@gbfm/core/roles'
import { Schema } from 'effect'

import { Principal } from '../../domain/principal'

const AccountMenuMessage = UiSchema.TaggedEnum({
  RequestedOpenAccountMenu: {},
  RequestedCloseAccountMenu: {},
})

export const AccountMenu = Html.component({
  name: 'AccountMenu',
  props: Schema.Struct({ principal: Principal }),
  model: Schema.Struct({ open: Schema.Boolean }),
  message: AccountMenuMessage,
  restore: false,
}).make({
  init: () => ({ open: false }),
  update: {
    RequestedOpenAccountMenu: ($) => $.evolve({ open: true }),
    RequestedCloseAccountMenu: ($) => $.evolve({ open: false }),
  },
  view: (h, model) => {
    const principal = h.props.principal
    const name = principal.name ?? principal.username ?? '?'

    const item = (href: string, label: string) =>
      h.a
        .attr('href', href)
        .class('block px-3 py-2 hover:bg-muted')
        .on('click', AccountMenuMessage.RequestedCloseAccountMenu())
        .children(label)

    return Popover(h, {
      props: { open: model.open },
      onEmit: {
        RequestedOpen: () => AccountMenuMessage.RequestedOpenAccountMenu(),
        RequestedClose: () => AccountMenuMessage.RequestedCloseAccountMenu(),
        Settled: () => undefined,
      },
      view: (popover) =>
        h.div.class('relative').children(
          popover
            .trigger({
              element: h.button
                .attr('type', 'button')
                .attr('aria-label', 'Account menu')
                .attr('title', name)
                .class(
                  'flex size-8 items-center justify-center overflow-hidden rounded-sm border border-border',
                ),
            })
            .children(
              principal.image
                ? h.img.attr('src', principal.image).attr('alt', '').class('size-full object-cover')
                : (name[0] ?? '?'),
            ),
          popover
            .portal(h.dialog)
            ?.children(
              popover
                .positioner(h.div)
                .children(
                  popover
                    .popup(
                      h.div
                        .attr('role', 'navigation')
                        .attr('aria-label', 'Account')
                        .class('account-menu'),
                    )
                    .children(
                      h.p.class('px-3 py-2 font-semibold').children(name),
                      principal.username
                        ? h.p.class('px-3 text-xs').children(`@${principal.username}`)
                        : null,
                      item('/dashboard', 'Dashboard'),
                      item('/listening', 'Listening pile'),
                      item('/dashboard/profile', 'Edit profile'),
                      canCreatePosts(principal.role)
                        ? h.div.children(
                            item('/new', 'New post'),
                            item('/mix-upload', 'New mix'),
                            item('/dashboard/content', 'My content'),
                          )
                        : null,
                      h.form
                        .attr('method', 'post')
                        .attr('action', '/actions/sign-out')
                        .children(
                          h.button
                            .attr('type', 'submit')
                            .class('block w-full px-3 py-2 text-left')
                            .children('Log out'),
                        ),
                    ),
                ),
            ),
        ),
    })
  },
})
