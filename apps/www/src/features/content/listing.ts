import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { ContentItem } from '../../domain/content-item'
import { ContentCards } from './cards'

export const ContentListingPageProps = Schema.Struct({
  items: Schema.Array(ContentItem),
  title: Schema.String,
  failure: Schema.NullOr(Schema.String),
  kind: Schema.String,
  tagged: Schema.optional(Schema.Boolean),
})

export const ContentListingPage = Html.component({
  name: 'ContentListingPage',
  props: ContentListingPageProps,
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) => {
    const { items, title, failure, kind, tagged } = h.props
    const tags = kind === 'tags' && !tagged

    return h.section.class('page').children(
      h.h1.children(title),
      failure && h.p.attr('role', 'alert').children(failure),
      tags &&
        items.length > 0 &&
        h.nav
          .class('detail-actions')
          .attr('aria-label', 'Tags')
          .children(
            items.map((item) => h.a.key(item.id).attr('href', item.href).children(item.title)),
          ),
      tags && items.length === 0 && h.p.children('No tags yet.'),
      tagged && !failure && items.length === 0 && h.p.children('No posts with this tag yet.'),
      !tags && (!tagged || !failure) && ContentCards(h, items),
    )
  },
})
