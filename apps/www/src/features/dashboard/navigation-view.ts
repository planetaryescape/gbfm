import type { Html } from '@effect/ui/html'

import type { Principal } from '../../domain/principal'
import { resolveSection, sectionHref, visibleWorkspaces } from './navigation'

interface Tab {
  readonly href: string
  readonly label: string
  readonly current: boolean
}

const Tabs = <M>(h: Html.H<M>, label: string, className: string, items: ReadonlyArray<Tab>) =>
  h.nav
    .attr('aria-label', label)
    .class(`dashboard-tabs ${className}`)
    .children(
      items.map((item) =>
        h.a
          .attr('href', item.href)
          .attr('aria-current', item.current ? 'page' : undefined)
          .children(item.label),
      ),
    )

export const ContentTypeTabs = <M>(h: Html.H<M>, section: string) =>
  Tabs(h, 'Content types', 'dashboard-subtabs', [
    { href: '/dashboard/all/mixes', label: 'Mixes', current: section === 'all/mixes' },
    { href: '/dashboard/all/tweets', label: 'Tweets', current: section === 'all/tweets' },
    { href: '/dashboard/all/editorial', label: 'Editorial', current: section === 'all/editorial' },
  ])

export const DashboardHeader = <M>(h: Html.H<M>, section: string, role: Principal['role']) => {
  const resolved = resolveSection(section, role)
  const available = visibleWorkspaces(role)

  const workspace =
    available.find((candidate) => candidate.label === resolved?.workspace.label) ?? available[0]

  const group = resolved?.group

  return h.header.class('dashboard-header').children(
    h.div.class('dashboard-header-top').children(
      h.a.class('dashboard-brand').attr('href', '/dashboard').children('Dashboard'),
      h.div.class('dashboard-header-actions').children(
        available.length > 1
          ? h.nav
              .attr('aria-label', 'Dashboard workspaces')
              .class('dashboard-workspaces')
              .children(
                available.map((candidate) =>
                  h.a
                    .attr('href', sectionHref(candidate.groups[0]?.pages[0].section ?? 'favorites'))
                    .attr('aria-current', candidate.label === workspace?.label ? 'page' : undefined)
                    .children(candidate.label),
                ),
              )
          : undefined,
        h.form
          .attr('method', 'post')
          .attr('action', '/actions/sign-out')
          .class('dashboard-sign-out')
          .children(
            h.button.attr('type', 'submit').class('dashboard-button-quiet').children('Sign out'),
          ),
      ),
    ),
    Tabs(
      h,
      'Dashboard sections',
      'dashboard-group-tabs',
      (workspace?.groups ?? []).map((candidate) => ({
        href: sectionHref(candidate.pages[0].section),
        label: candidate.label,
        current: candidate.label === group?.label,
      })),
    ),
    group && group.pages.length > 1
      ? Tabs(
          h,
          group.label,
          'dashboard-subtabs',
          group.pages.map((page) => ({
            href: sectionHref(page.section),
            label: page.label,
            current: page.section === resolved?.page.section,
          })),
        )
      : undefined,
  )
}
