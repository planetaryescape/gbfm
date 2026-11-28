import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { PageDocument } from '../../domain/page'
import { EditorialListPage } from '../editorial-list'
import { HomePage } from '../home'
import { ProfilePage } from '../profile'
import { MembershipButton } from '../public-actions/button'
import { ShowsPage } from '../shows'
import { ContentDetailPage } from './detail'
import { ContentListingPage } from './listing'

export const PublicContentPageProps = Schema.Struct({ document: PageDocument })

export const PublicContentPage = Html.component({
  name: 'PublicContentPage',
  props: PublicContentPageProps,
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) => {
    const { document } = h.props
    const path = new URL(document.url).pathname
    const segments = path.split('/').filter(Boolean)
    const kind = segments[0] ?? ''

    const actions = h.div.class('contents').children(
      document.publicAction &&
        MembershipButton(h, {
          props: {
            document: document.publicAction,
            iconOnly: document.publicAction.target.kind === 'audio',
          },
        }),
    )

    if (document.status === 404)
      return h.section
        .class('page')
        .children(h.h1.children('Page not found'), h.a.attr('href', '/').children('Return home'))

    if (document.shows)
      return ShowsPage(h, {
        props: { document: document.shows },
        slots: { actions },
      })

    if (document.profile) return ProfilePage(h, { props: { profile: document.profile } })

    if (path === '/')
      return HomePage(h, { props: { items: document.items, failure: document.failure } })

    if (kind === 'editorial' && segments.length === 1)
      return EditorialListPage(h, {
        props: {
          items: document.items,
          renderedAt: document.renderedAt,
          failure: document.failure,
        },
      })

    if (segments.length === 1 || kind === 'tags')
      return ContentListingPage(h, {
        props: {
          items: document.items,
          title: document.title,
          kind,
          tagged: kind === 'tags' && segments.length > 1,
          failure: document.failure,
        },
      })
    const item = document.items[0]

    if (!item)
      return h.section
        .class('page')
        .children(h.p.attr('role', 'alert').children(document.failure ?? 'Content not found.'))

    return ContentDetailPage(h, {
      key: path,
      props: {
        item,
        kind,
        url: document.url,
        principalId: document.principal?.id ?? null,
        hasActions: document.publicAction !== null,
      },
      slots: { actions },
    })
  },
})

export { ContentDetailPage, ContentDetailPageProps } from './detail'

export { ContentListingPage, ContentListingPageProps } from './listing'
