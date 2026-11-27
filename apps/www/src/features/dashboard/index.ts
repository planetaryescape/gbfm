import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { Principal } from '../../domain/principal'
import { DashboardAdminPanel } from './admin-panels'
import { DashboardAnnouncements } from './announcements'
import { DashboardApiKeys } from './api-keys'
import { DashboardCatalog } from './catalog'
import { DashboardCollection } from './collection'
import { DashboardDocument } from './document'
import { DashboardIntegrations } from './integrations'
import { DashboardLibrary } from './library'
import nativeStyles from './native.css?inline'
import { resolveSection } from './navigation'
import { ContentTypeTabs, DashboardHeader } from './navigation-view'
import { entityRoute, isAdminSection, sectionFromUrl, sectionLabel } from './sections'
import { DashboardSessions } from './sessions'
import { DashboardSettings } from './settings'

export const DashboardPageProps = Schema.Struct({
  url: Schema.String,
  principal: Principal,
  document: DashboardDocument,
})

export const DashboardPage = Html.component({
  name: 'DashboardPage',
  props: DashboardPageProps,
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) => {
    const { url, principal, document } = h.props
    const section = sectionFromUrl(url)
    const entity = entityRoute(section)
    const props = { section, principal, initialDocument: document, url }

    const title = () => {
      if (isAdminSection(section) && principal.role !== 'admin')
        return 'Administrator access required'

      if (section === 'overview') return 'Your dashboard'

      if (entity) return `Edit ${entity.kind}`

      return sectionLabel(section, principal.role)
    }

    const content = () => {
      if (isAdminSection(section) && principal.role !== 'admin')
        return h.p
          .attr('role', 'alert')
          .class('dashboard-forbidden')
          .children(
            'Administrator access required. This area is not available to your account. ',
            h.a.attr('href', '/dashboard').children('Go to your dashboard'),
          )

      if (['profile', 'email', 'player', 'appearance'].includes(section))
        return DashboardSettings(h, {
          key: `${principal.id}/${section}`,
          props: { section, initialDocument: document },
        })

      if (section === 'api-keys')
        return DashboardApiKeys(h, { key: principal.id, props: { principal } })

      if (section === 'sessions') return DashboardSessions(h, { key: principal.id })

      if (section === 'music' || section.startsWith('music-entity/'))
        return DashboardCatalog(h, { key: `${principal.id}/${url}`, props })

      if (section === 'shows' || section === 'playlists')
        return DashboardLibrary(h, { key: `${principal.id}/${section}`, props })

      if (section === 'emails') return DashboardAnnouncements(h, { key: principal.id, props })

      if (section === 'integrations' || section === 'spotify-callback')
        return DashboardIntegrations(h, {
          key: section,
          props: { callback: section === 'spotify-callback' },
        })

      if (
        ['overview', 'favorites', 'reminders'].includes(section) ||
        /^(content|all)\//.test(section)
      )
        return DashboardCollection(h, { key: `${principal.id}/${url}`, props })

      return DashboardAdminPanel(h, { key: `${principal.id}/${url}`, props })
    }

    return h.div
      .class('gbfm-dashboard')
      .children(
        h.el('style').children(nativeStyles),
        DashboardHeader(h, section, principal.role),
        h.section
          .class('dashboard-content')
          .children(
            h.header
              .class('dashboard-heading')
              .children(
                h.h1(title()),
                h.p(resolveSection(section, principal.role)?.group.description ?? ''),
              ),
            section.startsWith('all/') ? ContentTypeTabs(h, section) : undefined,
            content(),
          ),
      )
  },
})

export { DashboardDocument } from './document'
