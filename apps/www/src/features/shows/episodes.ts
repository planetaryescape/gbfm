import { Html } from '@effect/ui/html'
import { GetShowEpisodesResponse } from '@gbfm/api/shows'
import type { QueueTrackType } from '@gbfm/player'
import { Schema } from 'effect'

import { formatDate } from '../../domain/format/date'
import { artwork } from '../../ui/artwork'
import { PlaybackControls } from '../content/playback-controls'

export type Episode = (typeof GetShowEpisodesResponse.Type.data)[number]

export const episodeTrack = (episode: Episode): QueueTrackType => ({
  id: episode.id,
  title: episode.title,
  slug: episode.slug,
  url: episode.url,
  thumbnailUrl: episode.thumbnailUrl,
  type: episode.type,
  creators: episode.artists?.length ? episode.artists : episode.creators,
})

export const EpisodeListProps = Schema.Struct({
  episodes: Schema.NullOr(GetShowEpisodesResponse),
})

export const EpisodeList = Html.component({
  name: 'EpisodeList',
  props: EpisodeListProps,
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) => {
    const { episodes } = h.props

    if (!episodes)
      return h.p
        .attr('role', 'alert')
        .class('py-8 text-sm text-muted-foreground')
        .children('Episodes are unavailable right now. Reload the page to try again.')

    if (!episodes.data.length)
      return h.p.class('py-8 text-sm text-muted-foreground').children('No episodes yet.')

    const total = Math.max(episodes.pagination.total, episodes.data.length)

    return h.ol.class('m-0 list-none border-t border-border p-0').children(
      episodes.data.map((episode, index) => {
        const credits = episode.artists?.length ? episode.artists : (episode.creators ?? [])
        const number = episode.episodeNumber ?? total - index
        const href = `/mixes/${encodeURIComponent(episode.slug)}`

        return h.li
          .key(episode.id)
          .class(
            'episode-reveal group relative m-0 grid list-none grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 border-b border-border py-5 sm:grid-cols-[auto_4rem_minmax(0,1fr)_auto] sm:gap-x-6',
          )
          .children(
            PlaybackControls(h, {
              key: episode.id,
              props: { track: episodeTrack(episode), episodeNumber: number },
            }),
            h.a
              .attr('href', href)
              .attr('tabindex', '-1')
              .attr('aria-hidden', 'true')
              .class('hidden sm:block')
              .children(
                artwork(h, episode.thumbnailUrl, '', '64px', false, 'h-16 w-16 rounded-sm'),
              ),
            h.div.class('min-w-0').children(
              h.h3
                .class('m-0 text-base font-bold leading-snug')
                .children(
                  h.a
                    .attr('href', href)
                    .class('text-foreground no-underline hover:underline')
                    .children(episode.title),
                ),
              credits.length > 0 &&
                h.p.class('mt-1 text-sm text-muted-foreground').children(
                  credits.flatMap((credit, creditIndex) => [
                    creditIndex > 0 ? ', ' : '',
                    h.a
                      .key(credit.id)
                      .attr('href', `/profile/${encodeURIComponent(credit.username ?? credit.id)}`)
                      .class(
                        'font-semibold text-foreground/90 no-underline hover:text-highlight hover:underline',
                      )
                      .children(credit.name),
                  ]),
                ),
              h.p
                .class('mt-1 text-xs text-muted-foreground sm:hidden')
                .children(
                  h.time
                    .attr('datetime', episode.createdAt)
                    .children(formatDate(episode.createdAt)),
                ),
              episode.description &&
                h.p
                  .class('mt-1 line-clamp-2 max-w-prose text-sm text-muted-foreground')
                  .children(episode.description),
            ),
            h.div
              .class('hidden text-right text-xs text-muted-foreground sm:block')
              .children(
                h.time
                  .attr('datetime', episode.createdAt)
                  .class('block')
                  .children(formatDate(episode.createdAt)),
                episode.playCount > 0 &&
                  h.span
                    .class('block')
                    .children(`${episode.playCount} ${episode.playCount === 1 ? 'play' : 'plays'}`),
              ),
          )
      }),
    )
  },
})
