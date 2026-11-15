import { Match } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import { Message } from '../../message'
import type { ContentItem, Model } from '../../model'
import * as Player from '../../player'
import * as PublicActions from '../../public-actions'
import * as SpotifyReading from '../../spotify/reading'
import { spotlightDocument, spotlightProgress } from '../../spotlight-page'
import { artwork } from '../../view/artwork'
import { emailUpdatesInvite } from '../../view/email-updates'
import { formatDate } from '../../view/format-date'
import { iconPaths, lucide } from '../../view/icons'
import { richContent } from '../../view/rich-content/fallback'
import { richContentView } from '../../view/rich-content/render'
import { spotlightView } from '../../view/rich-content/spotlight'
import { draftNotice } from './draft-notice'

const kindLabel = (kind: string) =>
  Match.value(kind).pipe(
    Match.when('mixes', () => 'Mix'),
    Match.when('editorial', () => 'Editorial'),
    Match.orElse(() => null),
  )

const playButton =
  'inline-flex h-14 w-14 items-center justify-center rounded-sm border-0 bg-highlight p-0 text-highlight-foreground shadow-lg transition-transform hover:scale-104 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

const iconButton =
  'inline-flex h-11 w-11 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const chip =
  'inline-flex h-7 items-center gap-1.5 rounded-sm bg-muted px-2.5 text-xs font-semibold text-muted-foreground no-underline transition-colors hover:bg-highlight hover:text-highlight-foreground'

const track = (item: ContentItem, url: string) => ({
  id: item.id,
  title: item.title,
  url,
  slug: item.slug,
  thumbnailUrl: item.imageUrl,
  type: item.audioType ?? 'mix',
  creators: item.creators,
})

const creatorLinks = (h: HtmlBuilder<Message>, item: ContentItem) =>
  (item.creators ?? []).flatMap((creator, index) => [
    index > 0 ? ', ' : '',
    h.a(
      [
        h.Key(creator.id),
        h.Href(`/profile/${encodeURIComponent(creator.username ?? creator.id)}`),
        h.Class(
          'font-bold text-foreground no-underline transition-colors hover:text-highlight hover:underline',
        ),
      ],
      [creator.name],
    ),
  ])

const byline = (h: HtmlBuilder<Message>, item: ContentItem) => {
  const creators = creatorLinks(h, item)

  if (!creators.length && !item.meta) return h.empty

  return h.p(
    [h.Class('mt-3 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground')],
    [
      creators.length ? h.span([], creators) : h.empty,
      creators.length && item.meta ? h.span([h.AriaHidden(true)], ['·']) : h.empty,
      item.meta ? h.time([h.Datetime(item.meta)], [formatDate(item.meta)]) : h.empty,
    ],
  )
}

const masthead = (h: HtmlBuilder<Message>, item: ContentItem, kind: string) => {
  const label = kindLabel(kind)

  return h.header(
    [h.Class('flex flex-col gap-6 pt-6 sm:flex-row sm:items-end sm:gap-8 sm:pt-8')],
    [
      artwork(
        item.imageUrl,
        item.title,
        '(min-width: 1024px) 256px, (min-width: 640px) 208px, 192px',
        true,
        'w-48 shrink-0 rounded-sm shadow-2xl sm:w-52 lg:w-64',
      ),
      h.div(
        [h.Class('min-w-0 pb-1')],
        [
          label ? h.p([h.Class('m-0 mb-2 text-sm text-muted-foreground')], [label]) : h.empty,
          h.h1(
            [
              h.Class(
                'm-0 break-words text-[clamp(2rem,5vw,4rem)] font-black leading-[0.95] tracking-tighter text-foreground',
              ),
            ],
            [item.title],
          ),
          byline(h, item),
        ],
      ),
    ],
  )
}

const controls = (model: Model, h: HtmlBuilder<Message>, item: ContentItem) => {
  const current = model.player.snapshot.queue.current?.id === item.id
  const playing = current && model.player.snapshot.transport.isPlaying
  const playLabel = playing ? 'Pause' : 'Play'

  return h.div(
    [h.Class('mt-8 flex items-center gap-2')],
    [
      ...(item.audioUrl
        ? [
            h.button(
              [
                h.Type('button'),
                h.Disabled(!model.interactive),
                h.AriaLabel(playLabel),
                h.Title(playLabel),
                h.OnClick(
                  Message.GotPlayerMessage({
                    message: current
                      ? Player.Message.TogglePlayPause()
                      : Player.Message.PlayTrack({ track: track(item, item.audioUrl) }),
                  }),
                ),
                h.Class(`${playButton} mr-2`),
              ],
              [lucide(playing ? iconPaths.pause : iconPaths.play, 'h-6 w-6 fill-current')],
            ),
            h.button(
              [
                h.Type('button'),
                h.Disabled(!model.interactive),
                h.AriaLabel('Add to queue'),
                h.Title('Add to queue'),
                h.OnClick(
                  Message.GotPlayerMessage({
                    message: Player.Message.Enqueue({ track: track(item, item.audioUrl) }),
                  }),
                ),
                h.Class(iconButton),
              ],
              [lucide(iconPaths.listPlus, 'h-5 w-5')],
            ),
          ]
        : []),
      PublicActions.view(
        model.publicAction,
        h,
        (message) => Message.GotPublicActionMessage({ message }),
        model.interactive,
        true,
      ),
    ],
  )
}

const metaStrip = (h: HtmlBuilder<Message>, item: ContentItem) => {
  const streams = item.streamingLinks ?? []
  const tags = item.tags ?? []

  if (!streams.length && !tags.length) return h.empty

  return h.div(
    [h.Class('mt-6 flex flex-wrap gap-2')],
    [
      streams.length
        ? h.nav(
            [h.AriaLabel('Listen on'), h.Class('contents')],
            streams.map((stream) =>
              h.a(
                [
                  h.Key(stream.url),
                  h.Href(stream.url),
                  h.Target('_blank'),
                  h.Rel('noopener noreferrer'),
                  h.Class(chip),
                ],
                [stream.platform, lucide(iconPaths.externalLink, 'h-3 w-3')],
              ),
            ),
          )
        : h.empty,
      tags.length
        ? h.nav(
            [h.AriaLabel('Tags'), h.Class('contents')],
            tags.map((tag) =>
              h.a(
                [h.Key(tag), h.Href(`/tags/${encodeURIComponent(tag)}`), h.Class(chip)],
                [`#${tag}`],
              ),
            ),
          )
        : h.empty,
    ],
  )
}

const readingSpotify = (model: Model): SpotifyReading.ReadingSpotify<Message> => ({
  model: model.spotifyPlayback,
  toMessage: (message) => Message.GotSpotifyPlaybackMessage({ message }),
  interactive: model.interactive,
})

export const detailView = (model: Model, h: HtmlBuilder<Message>, kind: string) => {
  const item = model.flags.items[0]

  if (!item)
    return h.section(
      [h.Class('page')],
      [h.p([h.Role('alert')], [model.flags.failure ?? 'Content not found.'])],
    )

  const spotlight = kind === 'editorial' ? spotlightDocument(model) : null

  const at = spotlight ? spotlightProgress(model).at : null
  const walking = at !== null && at !== 'end'

  return h.article(
    [
      h.Class(
        spotlight
          ? 'content-detail spotlight-detail mx-auto px-4 pb-32 pt-6'
          : 'content-detail mx-auto max-w-5xl px-4 pb-32 pt-6',
      ),
    ],
    [
      kind === 'editorial' && item.draft ? draftNotice(h, item.slug) : h.empty,
      walking ? h.empty : masthead(h, item, kind),
      walking ? h.empty : controls(model, h, item),
      !walking && item.description
        ? h.p(
            [h.Class('mt-6 max-w-prose text-base leading-relaxed text-foreground/80')],
            [item.description],
          )
        : h.empty,
      walking ? h.empty : metaStrip(h, item),
      h.div(
        [h.Class(spotlight ? 'spotlight-body mt-4' : 'mt-10 max-w-prose')],
        [
          item.richContent === null
            ? richContent(item.content)
            : spotlight
              ? spotlightView(spotlight, h, {
                  ...spotlightProgress(model),
                  direction:
                    model.spotlight?.path === new URL(model.flags.url).pathname
                      ? model.spotlightMotion
                      : 'none',
                  onStep: (at) =>
                    Message.SpotlightStepped({ path: new URL(model.flags.url).pathname, at }),
                  onVideo: (video) => Message.VideoOpened({ video }),
                  musicActions: (music) =>
                    SpotifyReading.cardActions(h, readingSpotify(model), music.links),
                  onboarding: SpotifyReading.onboarding(h, readingSpotify(model)),
                })
              : richContentView(item.richContent, h),
        ],
      ),
      !walking && (kind === 'mixes' || kind === 'editorial') ? emailUpdatesInvite(h) : h.empty,
    ],
  )
}
