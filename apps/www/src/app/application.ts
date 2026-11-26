import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { staticPages } from '../domain/static/pages'
import { siteHead } from './head'
import { AppProps } from './props'
import { StaticPage } from './static-page'
import { ThemeButton } from './theme-button'

export const Application = Html.component({
  name: 'GbfmApplication',
  props: AppProps,
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  head: ({ props }) => siteHead(props.metadata),
  view: (h) => {
    const page = h.props.url.pathname.replace(/^\//, '')
    const document = staticPages.get(page)

    return h.div
      .class('site')
      .children(
        h.header
          .class('mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-6')
          .children(
            h.a.attr('href', '/').class('font-bold tracking-tight').children('goosebumps.fm'),
            h.nav
              .attr('aria-label', 'Primary')
              .class('flex items-center gap-4')
              .children(
                h.a.attr('href', '/about').children('About'),
                h.a.attr('href', '/privacy').children('Privacy'),
                h.a.attr('href', '/terms').children('Terms'),
                ThemeButton(h, {}),
              ),
          ),
        h.main.children(
          document
            ? StaticPage(h, { props: { page, title: document.title } })
            : h.section
                .class('page')
                .children(
                  h.h1.children('Page not found'),
                  h.a.attr('href', '/').children('Return home'),
                ),
        ),
      )
  },
})
