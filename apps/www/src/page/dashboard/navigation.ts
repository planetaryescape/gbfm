import type { HtmlBuilder } from 'foldkit/html'

import { resolveSection, sectionHref, visibleWorkspaces } from '../../features/dashboard/navigation'
import type { Message } from './message'
import type { Model } from './model'

type Role = Model['principal']['role']

export {
  type DashboardPage,
  type DashboardGroup,
  type DashboardWorkspace,
  type ResolvedSection,
  resolveSection,
  sectionHref,
  sectionLabel,
  visibleWorkspaces,
  workspaces,
} from '../../features/dashboard/navigation'

export interface Tab {
  readonly href: string
  readonly label: string
  readonly current: boolean
}

export const tabs = (
  h: HtmlBuilder<Message>,
  label: string,
  className: string,
  items: ReadonlyArray<Tab>,
) =>
  h.nav(
    [h.AriaLabel(label), h.Class(`dashboard-tabs ${className}`)],
    items.map((item) =>
      h.a([h.Href(item.href), ...(item.current ? [h.AriaCurrent('page')] : [])], [item.label]),
    ),
  )

export const subTabs = (h: HtmlBuilder<Message>, label: string, items: ReadonlyArray<Tab>) =>
  tabs(h, label, 'dashboard-subtabs', items)

export const dashboardHeader = (h: HtmlBuilder<Message>, section: string, role: Role) => {
  const resolved = resolveSection(section, role)
  const available = visibleWorkspaces(role)

  const workspace =
    available.find((candidate) => candidate.label === resolved?.workspace.label) ?? available[0]

  const group = resolved?.group

  return h.header(
    [h.Class('dashboard-header')],
    [
      h.div(
        [h.Class('dashboard-header-top')],
        [
          h.a([h.Href('/dashboard'), h.Class('dashboard-brand')], ['Dashboard']),
          h.div(
            [h.Class('dashboard-header-actions')],
            [
              available.length > 1
                ? h.nav(
                    [h.AriaLabel('Dashboard workspaces'), h.Class('dashboard-workspaces')],
                    available.map((candidate) =>
                      h.a(
                        [
                          h.Href(sectionHref(candidate.groups[0]?.pages[0].section ?? 'favorites')),
                          ...(candidate.label === workspace?.label ? [h.AriaCurrent('page')] : []),
                        ],
                        [candidate.label],
                      ),
                    ),
                  )
                : h.empty,
              h.form(
                [h.Method('post'), h.Action('/actions/sign-out'), h.Class('dashboard-sign-out')],
                [h.button([h.Type('submit'), h.Class('dashboard-button-quiet')], ['Sign out'])],
              ),
            ],
          ),
        ],
      ),
      tabs(
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
        ? subTabs(
            h,
            group.label,
            group.pages.map((page) => ({
              href: sectionHref(page.section),
              label: page.label,
              current: page.section === resolved?.page.section,
            })),
          )
        : h.empty,
    ],
  )
}
