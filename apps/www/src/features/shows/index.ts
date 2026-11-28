import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { ShowsDocument } from '../../domain/shows'
import { linkHostMentions } from '../../domain/shows/host-links'
import { artwork } from '../../ui/artwork'
import { PlaybackControls, PlaylistControls } from '../content/playback-controls'
import { ShowAbout } from './about'
import { EpisodeList, episodeTrack } from './episodes'

export const ShowsPageProps = Schema.Struct({ document: ShowsDocument })

export const ShowsPage = Html.component({
  name: 'ShowsPage',
  props: ShowsPageProps,
  model: Schema.Struct({}),
  message: Schema.Never,
  slots: ['actions'],
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) => {
    const { document } = h.props
    const selected = document.shows.find((show) => show.slug === document.selectedSlug)
    const latest = document.episodes?.data[0]
    const about = document.richContent?.blocks.length ? document.richContent : null

    if (!document.shows.length)
      return h.div
        .class('mx-auto max-w-5xl px-4 py-16')
        .children(
          h.h1.class('m-0 text-3xl font-black tracking-tight').children('Radio shows'),
          h.p.class('mt-4 text-muted-foreground').children('No shows are on air yet.'),
        )

    return h.div.class('mx-auto max-w-5xl px-4 pb-16 pt-4 sm:pt-6').children(
      h.nav
        .attr('aria-label', 'Shows')
        .class(
          '-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 no-scrollbar sm:mx-0 sm:px-0',
        )
        .children(
          document.shows.map((show) =>
            h.a
              .key(show.id)
              .attr('href', `/shows/${encodeURIComponent(show.slug)}`)
              .attr('aria-current', show.slug === document.selectedSlug ? 'page' : undefined)
              .class(
                `-mb-px flex shrink-0 items-center gap-3 border-b-2 py-3 pr-5 no-underline transition-colors ${show.slug === document.selectedSlug ? 'border-highlight text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`,
              )
              .children(
                artwork(h, show.thumbnailUrl, '', '40px', false, 'h-10 w-10 shrink-0 rounded-sm'),
                h.span
                  .class('flex min-w-0 flex-col leading-tight')
                  .children(
                    h.span.class('truncate text-sm font-bold').children(show.title),
                    h.span
                      .class('truncate text-xs text-muted-foreground')
                      .children(show.hosts.map((host) => host.name).join(', ')),
                  ),
              ),
          ),
        ),
      selected
        ? h.div
            .key(selected.id)
            .class('show-scope')
            .children(
              h.div.class('sticky top-0 z-30 hidden h-0 lg:block').children(
                h.div
                  .class(
                    'show-compact absolute inset-x-0 top-0 -mx-4 flex h-16 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-md',
                  )
                  .children(
                    artwork(
                      h,
                      selected.thumbnailUrl,
                      '',
                      '40px',
                      false,
                      'h-10 w-10 shrink-0 rounded-sm shadow-md',
                    ),
                    h.div
                      .class('min-w-0 flex-1 leading-tight')
                      .children(
                        h.p
                          .class('m-0 truncate text-base font-black tracking-tight')
                          .children(selected.title),
                        h.p
                          .class('m-0 truncate text-xs text-muted-foreground')
                          .children(selected.hosts.map((host) => host.name).join(', ')),
                      ),
                    latest &&
                      PlaybackControls(h, {
                        key: 'compact',
                        props: {
                          track: episodeTrack(latest),
                          compact: true,
                          label: 'Play latest',
                          resumeLabel: 'Resume',
                        },
                      }),
                  ),
              ),
              h.header
                .class(
                  'show-masthead grid gap-6 py-8 sm:grid-cols-[minmax(0,18rem)_1fr] sm:gap-10 sm:py-12',
                )
                .children(
                  artwork(
                    h,
                    selected.thumbnailUrl,
                    selected.title,
                    '(min-width: 640px) 288px, 60vw',
                    true,
                    'show-masthead-art w-3/5 max-w-56 rounded-sm shadow-2xl sm:w-full sm:max-w-none sm:self-start',
                  ),
                  h.div.class('show-masthead-copy flex min-w-0 flex-col').children(
                    h.h1
                      .class(
                        'm-0 break-words text-[clamp(2.5rem,7vw,5.5rem)] font-black leading-[0.9] tracking-tighter text-foreground',
                      )
                      .children(selected.title),
                    selected.hosts.length > 0 &&
                      h.p.class('m-0 mt-3 text-sm text-muted-foreground').children(
                        'hosted by ',
                        selected.hosts.flatMap((host, index) => [
                          host.username
                            ? h.a
                                .key(host.id)
                                .attr('href', `/${encodeURIComponent(host.username)}`)
                                .class(
                                  'font-semibold text-foreground underline decoration-border underline-offset-4 hover:text-highlight',
                                )
                                .children(host.name)
                            : h.span
                                .key(host.id)
                                .class('font-semibold text-foreground')
                                .children(host.name),
                          index < selected.hosts.length - 1 ? ', ' : '',
                        ]),
                      ),
                    about
                      ? ShowAbout(h, selected.title, linkHostMentions(about, selected.hosts))
                      : selected.description &&
                          h.p
                            .class('mt-5 max-w-prose text-base leading-relaxed text-foreground/80')
                            .children(selected.description),
                    h.div
                      .class('mt-6 flex min-h-10 flex-wrap items-center gap-3 sm:mt-auto sm:pt-6')
                      .children(
                        latest &&
                          PlaybackControls(h, {
                            key: 'latest',
                            props: {
                              track: episodeTrack(latest),
                              compact: true,
                              label: 'Play latest',
                              resumeLabel: 'Resume',
                            },
                          }),
                        h.slots.actions,
                      ),
                  ),
                ),
              h.section.attr('aria-label', 'Episodes').children(
                h.h2.class('sr-only').children('Episodes'),
                (document.episodes?.data.length ?? 0) > 0 &&
                  PlaylistControls(h, {
                    props: { tracks: (document.episodes?.data ?? []).map(episodeTrack) },
                  }),
                EpisodeList(h, { props: { episodes: document.episodes } }),
              ),
            )
        : h.p.class('py-12 text-muted-foreground').children('Choose a show to see its episodes.'),
    )
  },
})
