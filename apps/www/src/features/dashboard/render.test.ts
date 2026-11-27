import { Html, HtmlServer } from '@effect/ui/html'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { Principal } from '../../domain/principal'
import { runWithLayer } from '../player/testing'
import { SpotifyProvider, spotifyCommandsLayer } from '../spotify/provider'
import { emptyDocument, DashboardDocument } from './document'
import { DashboardPage } from './index'
import { adminSections, dashboardSections, sectionHref } from './sections'

const DashboardTestApp = Html.component({
  name: 'DashboardTestApp',
  props: Schema.Struct({ principal: Principal, url: Schema.String, document: DashboardDocument }),
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    SpotifyProvider(h, {
      props: { identity: h.props.principal.id },
      view: () => DashboardPage(h, { props: h.props }),
    }),
})

describe('native dashboard server rendering', () => {
  it('renders every dashboard section without executing browser-only account requests', async () => {
    const principal = { id: 'fixture-admin', name: 'Fixture', username: 'fixture', role: 'admin' }

    for (const [section, title] of [...dashboardSections, ...adminSections]) {
      const result = await runWithLayer(
        spotifyCommandsLayer,
        HtmlServer.renderToHtml(DashboardTestApp, {
          principal,
          url: `https://gbfm.test${sectionHref(section)}`,
          document: emptyDocument,
        }),
      )

      expect(result.html).toContain(title)
      expect(result.html).not.toContain('fixture-bearer')
      expect(result.html).not.toContain('Request failed')
    }
  })

  it('never mounts an administrative section for a non-administrator', async () => {
    const result = await runWithLayer(
      spotifyCommandsLayer,
      HtmlServer.renderToHtml(DashboardTestApp, {
        principal: { id: 'fixture-listener', name: null, username: null, role: 'user' },
        url: 'https://gbfm.test/dashboard/users',
        document: emptyDocument,
      }),
    )

    expect(result.html).toContain('Administrator access required.')
    expect(result.html).not.toContain('create-user')
    expect(result.html).not.toContain('list-user-sessions')
  })
})
