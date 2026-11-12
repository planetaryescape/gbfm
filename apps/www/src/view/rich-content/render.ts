import {
  bandcampDarkPlayerUrl,
  BANDCAMP_PLAYER_HEIGHT,
  mediaProviderLabels,
  mediaReference,
  type MediaProvider,
} from '@gbfm/rich-content/media'
import type { RichContentBlock, RichContentDocument } from '@gbfm/rich-content/schema'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { artwork, imageSource } from '../artwork'
import { iconPaths, lucide, spotifyIcon } from '../icons'
import { musicEntityLabels, musicPlatformLabel } from '../music-platform'

type RichContentInline = Extract<
  RichContentBlock,
  { readonly _tag: 'Paragraph' }
>['children'][number]

/** Presentation options for a rendered rich-content document. */
export interface RichContentViewOptions {
  readonly className?: string
}

const unreachable = (value: never): never => {
  throw new Error(`Unhandled rich-content variant: ${String(value)}`)
}

const isOutbound = (href: string): boolean =>
  href.startsWith('https://') || href.startsWith('http://') || href.startsWith('mailto:')

const linkAttributes = <Message>(href: string, h: HtmlBuilder<Message>) => [
  h.Href(href),
  ...(isOutbound(href) ? [h.Target('_blank'), h.Rel('noopener noreferrer')] : []),
]

const isYoutubeLink = (href: string): boolean => {
  try {
    const url = new URL(href)

    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(
        url.hostname,
      )
    )
  } catch {
    return false
  }
}

const inlineView = <Message>(inline: RichContentInline, h: HtmlBuilder<Message>): Html | string => {
  // oxlint-disable-next-line anti-slop-effect/no-manual-tag-comparison -- Schema-owned recursive unions have no generated matcher; this switch provides compile-time exhaustiveness.
  switch (inline._tag) {
    case 'Text':
      return inline.value
    case 'Emphasis':
      return h.em(
        [],
        inline.children.map((child) => inlineView(child, h)),
      )
    case 'Strong':
      return h.strong(
        [],
        inline.children.map((child) => inlineView(child, h)),
      )
    case 'Delete':
      return h.del(
        [],
        inline.children.map((child) => inlineView(child, h)),
      )
    case 'InlineCode':
      return h.code([], [inline.value])
    case 'Link':
      return h.a(
        [...linkAttributes(inline.href, h), ...(inline.title ? [h.Title(inline.title)] : [])],
        [
          ...inline.children.map((child) => inlineView(child, h)),
          ...(isYoutubeLink(inline.href)
            ? [lucide(iconPaths.youtube, 'rich-content-youtube-icon')]
            : []),
        ],
      )
    case 'Image':
      return h.img([
        imageSource(inline.src),
        h.Alt(inline.alt),
        h.Loading('lazy'),
        h.Decoding('async'),
        ...(inline.title ? [h.Title(inline.title)] : []),
      ])
    case 'Break':
      return h.br([])
    default:
      return unreachable(inline)
  }
}

const inlineChildren = <Message>(
  children: ReadonlyArray<RichContentInline>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> => children.map((child) => inlineView(child, h))

const headingView = <Message>(
  block: Extract<RichContentBlock, { readonly _tag: 'Heading' }>,
  h: HtmlBuilder<Message>,
): Html => {
  const children = inlineChildren(block.children, h)

  switch (block.level) {
    case 1:
      return h.h1([], children)
    case 2:
      return h.h2([], children)
    case 3:
      return h.h3([], children)
    case 4:
      return h.h4([], children)
    case 5:
      return h.h5([], children)
    case 6:
      return h.h6([], children)
    default:
      return unreachable(block.level)
  }
}

const listView = <Message>(
  block: Extract<RichContentBlock, { readonly _tag: 'List' }>,
  h: HtmlBuilder<Message>,
): Html => {
  const items = block.items.map((item) =>
    h.li(item.checked === null ? [] : [h.Class('rich-content-task-item')], [
      ...(item.checked === null
        ? []
        : [
            h.input([
              h.Type('checkbox'),
              h.Checked(item.checked),
              h.Disabled(true),
              h.AriaLabel(item.checked ? 'Completed task' : 'Incomplete task'),
            ]),
          ]),
      ...item.children.map((child) => blockView(child, h)),
    ]),
  )

  return block.ordered
    ? h.ol(block.start === null ? [] : [h.Start(block.start)], items)
    : h.ul([], items)
}

const tableCellAlignment = <Message>(
  alignment: 'left' | 'center' | 'right' | null | undefined,
  h: HtmlBuilder<Message>,
) => (alignment === null || alignment === undefined ? [] : [h.Style({ textAlign: alignment })])

const tableView = <Message>(
  block: Extract<RichContentBlock, { readonly _tag: 'Table' }>,
  h: HtmlBuilder<Message>,
): Html => {
  const [head, ...body] = block.rows

  const row = (cells: typeof head, header: boolean) =>
    h.tr(
      [],
      (cells ?? []).map((cell, index) =>
        header
          ? h.th(
              [...tableCellAlignment(block.align[index], h), h.Scope('col')],
              inlineChildren(cell, h),
            )
          : h.td(tableCellAlignment(block.align[index], h), inlineChildren(cell, h)),
      ),
    )

  return h.table(
    [],
    [
      ...(head === undefined ? [] : [h.thead([], [row(head, true)])]),
      ...(body.length === 0
        ? []
        : [
            h.tbody(
              [],
              body.map((cells) => row(cells, false)),
            ),
          ]),
    ],
  )
}

const visibleTrackCount = 10

const musicTrackRow = <Message>(
  track: Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>['music']['tracks'][number],
  position: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.li(
    [],
    [
      h.span([h.Class('rich-content-track-number'), h.AriaHidden(true)], [String(position)]),
      h.span(
        [h.Class('rich-content-track-title')],
        [track.url === null ? track.title : h.a(linkAttributes(track.url, h), [track.title])],
      ),
      ...(track.artists.length === 0
        ? []
        : [
            h.span(
              [h.Class('rich-content-track-artists'), h.Title(track.artists.join(', '))],
              [track.artists.join(', ')],
            ),
          ]),
    ],
  )

const musicTracksView = <Message>(
  title: string,
  tracks: Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>['music']['tracks'],
  h: HtmlBuilder<Message>,
): Html => {
  const visible = tracks.slice(0, visibleTrackCount)
  const hidden = tracks.slice(visibleTrackCount)

  return h.div(
    [h.Class('rich-content-music-tracks')],
    [
      h.ol(
        [h.Class('rich-content-track-list'), h.Role('list'), h.AriaLabel(`${title} tracks`)],
        visible.map((track, index) => musicTrackRow(track, index + 1, h)),
      ),
      ...(hidden.length === 0
        ? []
        : [
            h.details(
              [],
              [
                h.summary(
                  [],
                  [
                    h.span(
                      [h.Class('rich-content-disclosure-closed')],
                      [`Show all ${tracks.length} tracks`],
                    ),
                    h.span(
                      [h.Class('rich-content-disclosure-open')],
                      [`Hide tracks ${visibleTrackCount + 1}–${tracks.length}`],
                    ),
                    lucide(iconPaths.chevronDown, 'rich-content-disclosure-icon'),
                  ],
                ),
                h.ol(
                  [
                    h.Class('rich-content-track-list'),
                    h.Role('list'),
                    h.Start(visibleTrackCount + 1),
                    h.AriaLabel(`More ${title} tracks`),
                  ],
                  hidden.map((track, index) =>
                    musicTrackRow(track, visibleTrackCount + index + 1, h),
                  ),
                ),
              ],
            ),
          ]),
    ],
  )
}

const musicView = <Message>(
  block: Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>,
  h: HtmlBuilder<Message>,
): Html => {
  const music = block.music

  const credit =
    music.artists.length === 0 ? music.title : `${music.title} by ${music.artists.join(', ')}`

  return h.article(
    [
      h.Class('rich-content-music-card not-prose'),
      h.AriaLabel(`${musicEntityLabels[music.entityType]}: ${credit}`),
    ],
    [
      h.div(
        [h.Class('rich-content-music-head')],
        [
          ...(music.imageUrl === null
            ? []
            : [
                artwork(
                  music.imageUrl,
                  `Artwork for ${credit}`,
                  '(min-width: 640px) 112px, 80px',
                  false,
                  'rich-content-music-art',
                ),
              ]),
          h.div(
            [h.Class('rich-content-music-copy')],
            [
              h.p([h.Class('rich-content-music-type')], [musicEntityLabels[music.entityType]]),
              h.h3(
                [h.Class('rich-content-music-title')],
                [
                  h.a(
                    [
                      ...linkAttributes(music.canonicalUrl, h),
                      h.AriaLabel(
                        `${credit}${isOutbound(music.canonicalUrl) ? ' (opens in a new tab)' : ''}`,
                      ),
                    ],
                    [music.title],
                  ),
                ],
              ),
              ...(music.artists.length === 0
                ? []
                : [h.p([h.Class('rich-content-music-artists')], [music.artists.join(', ')])]),
              ...(music.description === null
                ? []
                : [h.p([h.Class('rich-content-music-description')], [music.description])]),
              ...(block.genres.length === 0
                ? []
                : [
                    h.ul(
                      [h.Class('rich-content-music-genres'), h.Role('list'), h.AriaLabel('Genres')],
                      block.genres.map((genre) => h.li([], [genre])),
                    ),
                  ]),
            ],
          ),
        ],
      ),
      ...(block.blurb === null ? [] : [h.p([h.Class('rich-content-music-blurb')], [block.blurb])]),
      ...(block.showTracks && music.tracks.length > 0
        ? [musicTracksView(music.title, music.tracks, h)]
        : []),
      ...(music.links.length === 0
        ? []
        : [
            h.ul(
              [h.Class('rich-content-music-links'), h.Role('list'), h.AriaLabel('Listen on')],
              music.links.map((link) =>
                h.li(
                  [],
                  [
                    h.a(
                      [
                        ...linkAttributes(link.url, h),
                        h.AriaLabel(
                          `Listen to ${credit} on ${musicPlatformLabel(link.platform)}${isOutbound(link.url) ? ' (opens in a new tab)' : ''}`,
                        ),
                      ],
                      [
                        ...(link.platform === 'spotify'
                          ? [spotifyIcon('rich-content-music-link-icon')]
                          : []),
                        musicPlatformLabel(link.platform),
                        lucide(
                          isYoutubeLink(link.url) ? iconPaths.youtube : iconPaths.externalLink,
                          'rich-content-music-link-external',
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ]),
    ],
  )
}

/** Fixed heights for audio players whose layout does not scale with width. */
const playerHeight = (
  block: Extract<RichContentBlock, { readonly _tag: 'ExternalMediaEmbed' }>,
): number | null => {
  if (block.provider === 'bandcamp') return BANDCAMP_PLAYER_HEIGHT

  if (block.provider === 'soundcloud') return 166

  if (block.provider === 'spotify')
    return /\/embed\/(track|episode)\//.test(block.embedUrl) ? 152 : 352

  return null
}

const hostOf = (href: string) => {
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return href
  }
}

const providerOf = (href: string): MediaProvider | null => {
  try {
    return mediaReference(new URL(href))?.provider ?? null
  } catch {
    return null
  }
}

const providerMark = <Message>(provider: MediaProvider | null, h: HtmlBuilder<Message>) =>
  h.span(
    [
      h.Class('rich-content-provider'),
      ...(provider ? [h.DataAttribute('provider', provider)] : []),
    ],
    [
      h.span([h.Class('rich-content-provider-dot'), h.AriaHidden(true)], []),
      provider ? mediaProviderLabels[provider] : 'Media',
    ],
  )

const mediaView = <Message>(
  block: Extract<RichContentBlock, { readonly _tag: 'ExternalMediaEmbed' }>,
  h: HtmlBuilder<Message>,
): Html => {
  const height = playerHeight(block)
  const label = mediaProviderLabels[block.provider]
  const dark = bandcampDarkPlayerUrl(block.embedUrl)

  // Hidden lazy frames never intersect the viewport, so only the visible theme's player loads.
  const players = dark
    ? [
        { src: block.embedUrl, theme: 'light' },
        { src: dark, theme: 'dark' },
      ]
    : [{ src: block.embedUrl, theme: null }]

  return h.figure(
    [h.Class('rich-content-media not-prose'), h.DataAttribute('provider', block.provider)],
    [
      h.div(
        [
          h.Class('rich-content-media-frame'),
          h.Style(
            height === null
              ? { aspectRatio: String(block.aspectRatio) }
              : { height: `${height}px` },
          ),
        ],
        players.map(({ src, theme }) =>
          h.iframe(
            [
              h.Src(src),
              ...(theme ? [h.Class(`rich-content-media-${theme}`)] : []),
              h.Title(`${label} player: ${block.title}`),
              h.Width('100%'),
              h.Height('100%'),
              h.Loading('lazy'),
              h.Referrerpolicy('strict-origin-when-cross-origin'),
              h.Allow('autoplay; encrypted-media; fullscreen; picture-in-picture'),
              h.Sandbox('allow-scripts allow-same-origin allow-presentation allow-popups'),
            ],
            [],
          ),
        ),
      ),
      h.figcaption(
        [h.Class('rich-content-media-source')],
        [
          providerMark(block.provider, h),
          h.a(
            [...linkAttributes(block.canonicalUrl, h), h.AriaLabel(`Open on ${label}`)],
            [
              h.span([h.Class('rich-content-media-host')], [hostOf(block.canonicalUrl)]),
              lucide(
                block.provider === 'youtube' ? iconPaths.youtube : iconPaths.externalLink,
                'rich-content-media-icon',
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

/** A link card for media whose player could not be resolved, so the post still reads well. */
const unavailableMediaView = <Message>(
  block: Extract<RichContentBlock, { readonly _tag: 'UnavailableEmbed' }>,
  h: HtmlBuilder<Message>,
): Html => {
  const provider = block.href === null ? null : providerOf(block.href)
  const label = provider ? mediaProviderLabels[provider] : null

  return h.aside(
    [
      h.Class('rich-content-link-card not-prose'),
      ...(provider ? [h.DataAttribute('provider', provider)] : []),
    ],
    [
      h.div(
        [h.Class('rich-content-link-card-copy')],
        [
          providerMark(provider, h),
          h.p(
            [h.Class('rich-content-link-card-title')],
            [block.href === null ? 'Embedded media' : hostOf(block.href)],
          ),
          h.p([h.Class('rich-content-link-card-meta')], ['Player unavailable right now']),
        ],
      ),
      block.href === null
        ? h.empty
        : h.a(
            [...linkAttributes(block.href, h), h.Class('btn btn-sm')],
            [
              label ? `Listen on ${label}` : 'Open link',
              lucide(
                provider === 'youtube' ? iconPaths.youtube : iconPaths.externalLink,
                'h-3 w-3',
              ),
            ],
          ),
    ],
  )
}

const blockView = <Message>(block: RichContentBlock, h: HtmlBuilder<Message>): Html => {
  // oxlint-disable-next-line anti-slop-effect/no-manual-tag-comparison -- Schema-owned recursive unions have no generated matcher; this switch provides compile-time exhaustiveness.
  switch (block._tag) {
    case 'Paragraph':
      return h.p([], inlineChildren(block.children, h))
    case 'Heading':
      return headingView(block, h)
    case 'List':
      return listView(block, h)
    case 'Quote':
      return h.blockquote(
        [],
        block.children.map((child) => blockView(child, h)),
      )
    case 'Code':
      return h.pre(
        [],
        [
          ...(block.language === null
            ? []
            : [h.span([h.Class('rich-content-code-language')], [block.language])]),
          h.code([], [block.value]),
        ],
      )
    case 'ThematicBreak':
      return h.hr([])
    case 'Table':
      return tableView(block, h)
    case 'MusicEmbed':
      return musicView(block, h)
    case 'ExternalMediaEmbed':
      return mediaView(block, h)
    case 'Tracklist':
      return h.ol(
        [
          h.Class('rich-content-tracklist rich-content-track-list not-prose'),
          h.Role('list'),
          h.AriaLabel('Tracklist'),
        ],
        block.tracks.map((track, index) =>
          h.li(
            [],
            [
              h.span(
                [h.Class('rich-content-track-number'), h.AriaHidden(true)],
                [String(index + 1)],
              ),
              h.span([h.Class('rich-content-track-title')], [track.title]),
            ],
          ),
        ),
      )
    case 'CardGroup':
      return h.div(
        [h.Class('rich-content-card-group'), h.Role('group'), h.AriaLabel('Related music')],
        block.children.map((child) => blockView(child, h)),
      )
    case 'UnavailableEmbed':
      if (block.kind === 'media') return unavailableMediaView(block, h)

      return h.aside(
        [h.Class('rich-content-unavailable'), h.Role('status')],
        [
          h.p([], [block.label]),
          ...(block.href === null
            ? []
            : [h.a(linkAttributes(block.href, h), ['Open the original content'])]),
        ],
      )
    case 'Unsupported':
      return h.aside(
        [h.Class('rich-content-unsupported')],
        [
          h.p([], [`Unsupported content (${block.reason})`]),
          h.pre([], [h.code([], [block.source])]),
        ],
      )
    default:
      return unreachable(block)
  }
}

/** Maps a decoded rich-content document to inert Foldkit HTML without parsing source. */
export const richContentView = <Message>(
  document: RichContentDocument,
  h: HtmlBuilder<Message>,
  options: RichContentViewOptions = {},
): Html =>
  h.div(
    [h.Class(['rich-content', options.className].filter((value) => value !== undefined).join(' '))],
    document.blocks.map((block) => blockView(block, h)),
  )
