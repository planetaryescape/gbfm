import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { ContentItem } from '../../domain/content-item'
import { artwork } from '../../ui/artwork'
import { iconPaths, lucide } from '../../ui/icons'
import { contentTrack } from '../content/cards'
import { PlaybackControls, PlaylistControls } from '../content/playback-controls'

export const HomePageProps = Schema.Struct({
  items: Schema.Array(ContentItem),
  failure: Schema.NullOr(Schema.String),
})

export const HomePage = Html.component({
  name: 'HomePage',
  props: HomePageProps,
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) => {
    const mix = h.props.items[0]
    const track = mix ? contentTrack(mix) : null

    const tracks = h.props.items.flatMap((item) => {
      const value = contentTrack(item)

      return value ? [value] : []
    })

    return h.section.class('home').children(
      h.h1.children('goosebumps.', h.br, h.span.children('fm')),
      h.props.failure && h.p.attr('role', 'alert').children(h.props.failure),
      h.div.class('featured').children(
        h.div.class('featured-art').children(
          artwork(h, mix?.imageUrl, mix?.title ?? 'goosebumps.fm', '320px', true),
          h.div.class('featured-overlay').children(
            h.span.class('featured-label').children('Featured'),
            h.div.children(
              mix
                ? h.a.attr('href', mix.href).class('featured-title').children(mix.title)
                : h.p.children('No featured mix available'),
              mix?.creators &&
                h.p
                  .class('featured-creators')
                  .children(mix.creators.map((creator) => creator.name).join(', ')),
              track &&
                PlaybackControls(h, {
                  props: { track, compact: true, label: 'Play mix', toggleCurrent: false },
                }),
            ),
          ),
        ),
        h.a
          .attr('href', '/shows')
          .class('browse-shows')
          .children(lucide(h, iconPaths.radio, 'size-4'), h.span.children('Browse radio shows')),
        tracks.length > 1 && PlaylistControls(h, { props: { tracks } }),
      ),
    )
  },
})
