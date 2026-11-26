import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { aboutLinks, staticPages } from '../domain/static/pages'

export const StaticPage = Html.component({
  name: 'StaticPage',
  props: Schema.Struct({
    page: Schema.String,
    title: Schema.String,
  }),
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) => {
    const { page, title } = h.props

    return h.article
      .class(
        'page prose prose-headings:text-foreground prose-p:text-foreground/80 prose-li:text-foreground/80 prose-a:text-foreground prose-a:hover:text-highlight prose-strong:text-foreground marker:text-muted-foreground',
      )
      .children(
        h.h1.children(title),
        (staticPages.get(page)?.paragraphs ?? []).map((text) =>
          h.p.class('content-paragraph').children(text),
        ),
        page === 'about' &&
          aboutLinks.map(({ heading, links }) =>
            h.section
              .key(heading)
              .children(
                h.h2.children(heading),
                h.ul.children(
                  links.map(([href, label]) =>
                    h.li.key(href).children(h.a.attr('href', href).children(label)),
                  ),
                ),
              ),
          ),
      )
  },
})
