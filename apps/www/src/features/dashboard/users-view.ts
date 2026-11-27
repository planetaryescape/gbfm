import type { Html } from '@effect/ui/html'
import { ROLES } from '@gbfm/core/roles'

import type { DashboardDocument } from './document'
import { DataTable, Pagination } from './presentation'
import { pageOffset } from './sections'

export const UsersView = <M>(h: Html.H<M>, document: DashboardDocument, href: string) => {
  const url = new URL(href, 'http://localhost')

  const hidden = (name: string, value: string) =>
    h.input.attr('type', 'hidden').attr('name', name).attr('value', value)

  const input = (name: string, label: string, type = 'text') =>
    h.label.children(label, h.input.attr('name', name).attr('type', type))

  const roles = (role: string) =>
    h.select
      .attr('name', 'role')
      .attr('aria-label', 'Role')
      .children(
        ROLES.map((value) =>
          h.option
            .attr('value', value)
            .attr('selected', value === role ? '' : undefined)
            .children(value),
        ),
      )

  const action = (name: string) =>
    h.form
      .attr('method', 'post')
      .attr(
        'action',
        `/actions/admin/${name}?${new URLSearchParams({ search: url.searchParams.get('search') ?? '', offset: String(pageOffset(url.searchParams)) })}`,
      )

  const users = document.users

  const accountStatus = (user: NonNullable<DashboardDocument['users']>['users'][number]) => {
    if (user.banned) return h.span.attr('title', user.banReason ?? undefined).children('Banned')

    return h.span(user.emailVerified === false ? 'Unverified' : 'Active')
  }

  return h.div.children(
    h.details.children(
      h.summary('New user'),
      action('create-user')
        .class('dashboard-form')
        .children(
          input('name', 'Display name'),
          input('username', 'Username'),
          input('email', 'Email', 'email'),
          input('password', 'Password (optional)', 'password'),
          h.label.children('Role', roles('user')),
          h.p(
            'Provide an email or username. A blank password is generated securely. Use Invite to send access instructions.',
          ),
          h.button.attr('type', 'submit').children('Create account'),
        ),
    ),
    h.form
      .attr('method', 'get')
      .attr('action', '/dashboard/users')
      .attr('role', 'search')
      .children(
        h.input
          .attr('name', 'search')
          .attr('type', 'search')
          .attr('aria-label', 'Search by email')
          .attr('value', url.searchParams.get('search') ?? ''),
        h.button.attr('type', 'submit').children('Search users'),
      ),
    users
      ? DataTable(h, 'User accounts', ['Account', 'Email', 'Role', 'Status', 'Actions']).children(
          h.tbody.children(
            users.users.map((user) =>
              h.tr
                .key(user.id)
                .class('admin-row')
                .children(
                  h.td.children(
                    h.strong(user.name),
                    user.username
                      ? h.a
                          .attr('href', `/profile/${encodeURIComponent(user.username)}`)
                          .children(`@${user.username}`)
                      : undefined,
                  ),
                  h.td(user.email),
                  h.td.children(
                    action('set-role').children(
                      hidden('userId', user.id),
                      roles(user.role ?? 'user'),
                      h.button.attr('type', 'submit').children('Save role'),
                    ),
                  ),
                  h.td.children(accountStatus(user)),
                  h.td.children(
                    h.details.children(
                      h.summary('More'),
                      action('invite').children(
                        hidden('userId', user.id),
                        h.button.attr('type', 'submit').children('Invite'),
                      ),
                      user.banned
                        ? action('unban-user').children(
                            hidden('userId', user.id),
                            h.button.attr('type', 'submit').children('Unban'),
                          )
                        : h.details.children(
                            h.summary('Ban'),
                            action('ban-user').children(
                              hidden('userId', user.id),
                              input('banReason', 'Ban reason (optional)'),
                              h.button.attr('type', 'submit').children('Confirm ban'),
                            ),
                          ),
                      h.details.children(
                        h.summary('Delete'),
                        action('remove-user').children(
                          hidden('userId', user.id),
                          h.p(`Permanently delete ${user.name}? This cannot be undone.`),
                          h.button.attr('type', 'submit').children('Confirm delete'),
                        ),
                      ),
                    ),
                  ),
                ),
            ),
          ),
        )
      : h.p.attr('role', 'alert').children('Could not load user accounts.'),
    users
      ? Pagination(
          h,
          {
            ...document,
            pagination: {
              total: users.total,
              limit: users.limit,
              offset: pageOffset(url.searchParams),
              hasMore: pageOffset(url.searchParams) + users.users.length < users.total,
            },
          },
          href,
        )
      : undefined,
  )
}
