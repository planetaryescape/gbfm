import { canCreatePosts } from '@gbfm/core/roles'
import type { HtmlBuilder } from 'foldkit/html'

import type { Message } from './message'
import type { Model } from './model'

type Role = Model['principal']['role']

export interface DashboardPage {
  readonly section: string
  readonly label: string
  readonly aliases?: ReadonlyArray<string>
  readonly prefix?: string
}

export interface DashboardGroup {
  readonly label: string
  readonly description: string
  readonly pages: readonly [DashboardPage, ...ReadonlyArray<DashboardPage>]
  readonly visible: (role: Role) => boolean
}

export interface DashboardWorkspace {
  readonly label: string
  readonly groups: ReadonlyArray<DashboardGroup>
  readonly visible: (role: Role) => boolean
}

const everyone = () => true

const isAdmin = (role: Role) => role === 'admin'

export const workspaces = {
  you: {
    label: 'You',
    visible: everyone,
    groups: [
      {
        label: 'Library',
        description: 'Mixes you saved and releases you are waiting for',
        visible: everyone,
        pages: [
          { section: 'favorites', label: 'Favorites' },
          { section: 'reminders', label: 'Reminders' },
        ],
      },
      {
        label: 'My content',
        description: 'Mixes, tweets and editorial you published',
        visible: canCreatePosts,
        pages: [
          { section: 'content/mixes', label: 'Mixes' },
          { section: 'content/tweets', label: 'Tweets' },
          { section: 'content/editorial', label: 'Editorial' },
        ],
      },
      {
        label: 'Settings',
        description: 'Your profile, email and playback preferences',
        visible: everyone,
        pages: [
          { section: 'profile', label: 'Profile' },
          { section: 'appearance', label: 'Appearance' },
          { section: 'email', label: 'Email' },
          { section: 'player', label: 'Player' },
          { section: 'integrations', label: 'Integrations', aliases: ['spotify-callback'] },
          { section: 'api-keys', label: 'API keys' },
          { section: 'connections', label: 'Connections' },
        ],
      },
    ],
  },
  admin: {
    label: 'Admin',
    visible: isAdmin,
    groups: [
      {
        label: 'Overview',
        description: 'Site numbers at a glance',
        visible: isAdmin,
        pages: [{ section: 'admin', label: 'Overview' }],
      },
      {
        label: 'Content',
        description: 'Manage every post, curate shows and pick the homepage mix',
        visible: isAdmin,
        pages: [
          { section: 'all/mixes', label: 'All content', prefix: 'all/' },
          { section: 'shows', label: 'Shows' },
          { section: 'featured-mix', label: 'Featured mix' },
        ],
      },
      {
        label: 'Music',
        description: 'Edit artists, albums, tracks and labels, and sync playlists',
        visible: isAdmin,
        pages: [
          { section: 'music', label: 'Catalog', prefix: 'music-entity/' },
          { section: 'playlists', label: 'Playlists' },
        ],
      },
      {
        label: 'People',
        description: 'Look up accounts and active sessions',
        visible: isAdmin,
        pages: [
          { section: 'users', label: 'Users' },
          { section: 'sessions', label: 'Sessions' },
        ],
      },
      {
        label: 'Comms',
        description: 'Announce a mix and check what was delivered',
        visible: isAdmin,
        pages: [
          { section: 'emails', label: 'Write email' },
          { section: 'newsletter', label: 'Subscribers' },
          { section: 'email-logs', label: 'Delivery history' },
        ],
      },
      {
        label: 'System',
        description: 'Watch client errors and check search results',
        visible: isAdmin,
        pages: [
          { section: 'frontend-errors', label: 'Telemetry' },
          { section: 'search', label: 'Search' },
        ],
      },
    ],
  },
} satisfies Record<string, DashboardWorkspace>

export const visibleWorkspaces = (role: Role): ReadonlyArray<DashboardWorkspace> =>
  Object.values(workspaces)
    .filter((workspace) => workspace.visible(role))
    .map((workspace) => ({
      ...workspace,
      groups: workspace.groups.filter((group) => group.visible(role)),
    }))

const matches = (page: DashboardPage, section: string) =>
  page.section === section ||
  (page.aliases ?? []).includes(section) ||
  (page.prefix !== undefined && section.startsWith(page.prefix))

export interface ResolvedSection {
  readonly workspace: DashboardWorkspace
  readonly group: DashboardGroup
  readonly page: DashboardPage
}

export const resolveSection = (section: string, role: Role): ResolvedSection | null => {
  for (const workspace of visibleWorkspaces(role))
    for (const group of workspace.groups)
      for (const page of group.pages) if (matches(page, section)) return { workspace, group, page }

  return null
}

export const sectionLabel = (section: string, role: Role) =>
  resolveSection(section, role)?.page.label ?? section.replaceAll('-', ' ')

export const sectionHref = (section: string) =>
  section === 'favorites' ? '/dashboard' : `/dashboard/${section}`

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
