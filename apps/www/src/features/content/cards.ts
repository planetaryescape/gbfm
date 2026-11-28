import type { Html } from '@effect/ui/html'
import type { QueueTrackType } from '@gbfm/player'

import type { ContentItem } from '../../domain/content-item'
import { artwork } from '../../ui/artwork'
import { PlaybackControls } from './playback-controls'

export const contentTrack = (item: ContentItem): QueueTrackType | null =>
  item.audioUrl
    ? {
        id: item.id,
        title: item.title,
        url: item.audioUrl,
        slug: item.slug,
        thumbnailUrl: item.imageUrl,
        type: item.audioType ?? 'mix',
        creators: item.creators,
      }
    : null

export const CreatorLinks = <M>(h: Html.H<M>, item: Pick<ContentItem, 'creators'>) =>
  (item.creators ?? []).flatMap((creator, index) => [
    index > 0 ? ', ' : '',
    h.a
      .key(creator.id)
      .attr('href', `/profile/${encodeURIComponent(creator.username ?? creator.id)}`)
      .class('font-semibold text-foreground no-underline hover:text-highlight hover:underline')
      .children(creator.name),
  ])

export const ContentCards = <M>(h: Html.H<M>, items: ReadonlyArray<ContentItem>) =>
  h.div.class('cards').children(
    items.map((item) => {
      const track = contentTrack(item)

      return h.article
        .key(item.id)
        .class('card')
        .children(
          artwork(h, item.imageUrl, '', '(max-width: 1023px) 45vw, 25vw'),
          h.div.class('card-copy').children(
            h.a.attr('href', item.href).class('card-title').children(item.title),
            item.draft && h.span.class('profile-draft').children('Draft'),
            item.meta && h.small.children(item.meta),
            item.description && h.p.children(item.description),
            track &&
              PlaybackControls(h, {
                key: item.id,
                props: { track, compact: true, toggleCurrent: false },
              }),
          ),
        )
    }),
  )
