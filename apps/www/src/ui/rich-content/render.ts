import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'
import {
  bandcampDarkPlayerUrl,
  BANDCAMP_PLAYER_HEIGHT,
  mediaProviderLabels,
  mediaReference,
  type MediaProvider,
} from '@gbfm/rich-content/media'
import type { RichContentBlock, RichContentDocument } from '@gbfm/rich-content/schema'

import { musicEntityLabels, musicPlatformLabel } from '../../domain/content/music-platform'
import { artwork, imageSource } from '../artwork'
import { iconPaths, lucide } from '../icons'
import { musicPlatformIcon } from '../music-platform-icon'
import { microView } from './micro'

type RichContentInline = Extract<
  RichContentBlock,
  { readonly _tag: 'Paragraph' }
>['children'][number]

/** Lets a page add its own controls to music cards without changing how cards render elsewhere. */
export interface BlockViewExtras<Message, R = never> {
  readonly musicActions?: (music: MusicEmbedBlock['music']) => View.Content<Message, R>
}

type MusicEmbedBlock = Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>

/** Presentation options for a rendered rich-content document. */
export interface RichContentViewOptions {
  readonly className?: string
}

const unreachable = (value: never): never => {
  throw new Error(`Unhandled rich-content variant: ${String(value)}`)
}

const isOutbound = (href: string): boolean =>
  href.startsWith('https://') || href.startsWith('http://') || href.startsWith('mailto:')

const linkAttributes = (href: string) => ({
  href,
  target: isOutbound(href) ? '_blank' : undefined,
  rel: isOutbound(href) ? 'noopener noreferrer' : undefined,
})

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

const inlineView = <Message>(
  h: Html.H<Message>,
  inline: RichContentInline,
): View.Content<Message> | string => {
  // oxlint-disable-next-line anti-slop-effect/no-manual-tag-comparison -- Schema-owned recursive unions have no generated matcher; this switch provides compile-time exhaustiveness.
  switch (inline._tag) {
    case 'Text':
      return inline.value
    case 'Emphasis':
      return h.em.children(inline.children.map((child) => inlineView(h, child)))
    case 'Strong':
      return h.strong.children(inline.children.map((child) => inlineView(h, child)))
    case 'Delete':
      return h.del.children(inline.children.map((child) => inlineView(h, child)))
    case 'InlineCode':
      return h.code.children([inline.value])
    case 'Link':
      return h.a
        .attrs(linkAttributes(inline.href))
        .attrs(inline.title ? { title: inline.title } : {})
        .children([
          ...inline.children.map((child) => inlineView(h, child)),
          ...(isYoutubeLink(inline.href)
            ? [lucide(h, iconPaths.youtube, 'rich-content-youtube-icon')]
            : []),
        ])
    case 'Image':
      return imageSource(h, inline.src)
        .attr('alt', inline.alt)
        .attr('loading', 'lazy')
        .attr('decoding', 'async')
        .attrs(inline.title ? { title: inline.title } : {})
    case 'Break':
      return h.br
    default:
      return unreachable(inline)
  }
}

export const inlineChildren = <Message>(
  h: Html.H<Message>,
  children: ReadonlyArray<RichContentInline>,
): ReadonlyArray<View.Content<Message> | string> => children.map((child) => inlineView(h, child))

const headingView = <Message>(
  h: Html.H<Message>,
  block: Extract<RichContentBlock, { readonly _tag: 'Heading' }>,
): View.Content<Message> => {
  const children = inlineChildren(h, block.children)

  switch (block.level) {
    case 1:
      return h.h1.children(children)
    case 2:
      return h.h2.children(children)
    case 3:
      return h.h3.children(children)
    case 4:
      return h.h4.children(children)
    case 5:
      return h.h5.children(children)
    case 6:
      return h.h6.children(children)
    default:
      return unreachable(block.level)
  }
}

const listView = <Message>(
  h: Html.H<Message>,
  block: Extract<RichContentBlock, { readonly _tag: 'List' }>,
): View.Content<Message> => {
  const items = block.items.map((item) =>
    h.li.class(item.checked === null ? '' : 'rich-content-task-item').children([
      ...(item.checked === null
        ? []
        : [
            h.input
              .attr('type', 'checkbox')
              .checked(item.checked)
              .attr('disabled', '')
              .attr('aria-label', item.checked ? 'Completed task' : 'Incomplete task'),
          ]),
      ...item.children.map((child) => blockView(h, child)),
    ]),
  )

  return block.ordered
    ? h.ol.attrs(block.start === null ? {} : { start: String(block.start) }).children(items)
    : h.ul.children(items)
}

const tableCellAlignment = (alignment: 'left' | 'center' | 'right' | null | undefined) => ({
  textAlign: alignment ?? undefined,
})

const tableView = <Message>(
  h: Html.H<Message>,
  block: Extract<RichContentBlock, { readonly _tag: 'Table' }>,
): View.Content<Message> => {
  const [head, ...body] = block.rows

  const row = (cells: typeof head, header: boolean) =>
    h.tr.children(
      (cells ?? []).map((cell, index) =>
        header
          ? h.th
              .style(tableCellAlignment(block.align[index]))
              .attr('scope', 'col')
              .children(inlineChildren(h, cell))
          : h.td.style(tableCellAlignment(block.align[index])).children(inlineChildren(h, cell)),
      ),
    )

  return h.table.children([
    ...(head === undefined ? [] : [h.thead.children([row(head, true)])]),
    ...(body.length === 0 ? [] : [h.tbody.children(body.map((cells) => row(cells, false)))]),
  ])
}

const visibleTrackCount = 10

const musicTrackRow = <Message>(
  h: Html.H<Message>,
  track: Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>['music']['tracks'][number],
  position: number,
): View.Content<Message> =>
  h.li.children([
    h.span
      .class('rich-content-track-number')
      .attr('aria-hidden', String(true))
      .children([String(position)]),
    h.span
      .class('rich-content-track-title')
      .children([
        track.url === null
          ? track.title
          : h.a.attrs(linkAttributes(track.url)).children([track.title]),
      ]),
    ...(track.artists.length === 0
      ? []
      : [
          h.span
            .class('rich-content-track-artists')
            .attr('title', track.artists.join(', '))
            .children([track.artists.join(', ')]),
        ]),
  ])

const musicTracksView = <Message>(
  h: Html.H<Message>,
  title: string,
  tracks: Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>['music']['tracks'],
): View.Content<Message> => {
  const visible = tracks.slice(0, visibleTrackCount)
  const hidden = tracks.slice(visibleTrackCount)

  return h.div.class('rich-content-music-tracks').children([
    h.ol
      .class('rich-content-track-list')
      .attr('role', 'list')
      .attr('aria-label', `${title} tracks`)
      .children(visible.map((track, index) => musicTrackRow(h, track, index + 1))),
    ...(hidden.length === 0
      ? []
      : [
          h.details.children([
            h.summary.children([
              h.span
                .class('rich-content-disclosure-closed')
                .children([`Show all ${tracks.length} tracks`]),
              h.span
                .class('rich-content-disclosure-open')
                .children([`Hide tracks ${visibleTrackCount + 1}–${tracks.length}`]),
              lucide(h, iconPaths.chevronDown, 'rich-content-disclosure-icon'),
            ]),
            h.ol
              .class('rich-content-track-list')
              .attr('role', 'list')
              .attr('start', String(visibleTrackCount + 1))
              .attr('aria-label', `More ${title} tracks`)
              .children(
                hidden.map((track, index) =>
                  musicTrackRow(h, track, visibleTrackCount + index + 1),
                ),
              ),
          ]),
        ]),
  ])
}

const musicView = <Message, R = never>(
  h: Html.H<Message>,
  block: Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>,
  extras: BlockViewExtras<Message, R> = {},
) => {
  const music = block.music

  const credit =
    music.artists.length === 0 ? music.title : `${music.title} by ${music.artists.join(', ')}`

  return h.article
    .class('rich-content-music-card not-prose')
    .attr('aria-label', `${musicEntityLabels[music.entityType]}: ${credit}`)
    .children([
      h.div.class('rich-content-music-head').children([
        ...(music.imageUrl === null
          ? []
          : [
              artwork(
                h,
                music.imageUrl,
                `Artwork for ${credit}`,
                '(min-width: 640px) 112px, 80px',
                false,
                'rich-content-music-art',
              ),
            ]),
        h.div.class('rich-content-music-copy').children([
          h.p.class('rich-content-music-type').children([musicEntityLabels[music.entityType]]),
          h.h3.class('rich-content-music-title').children([
            h.a
              .attrs(linkAttributes(music.canonicalUrl))
              .attr(
                'aria-label',
                `${credit}${isOutbound(music.canonicalUrl) ? ' (opens in a new tab)' : ''}`,
              )
              .children([music.title]),
          ]),
          ...(music.artists.length === 0
            ? []
            : [h.p.class('rich-content-music-artists').children([music.artists.join(', ')])]),
          ...(music.description === null
            ? []
            : [h.p.class('rich-content-music-description').children([music.description])]),
          ...(block.genres.length === 0
            ? []
            : [
                h.ul
                  .class('rich-content-music-genres')
                  .attr('role', 'list')
                  .attr('aria-label', 'Genres')
                  .children(block.genres.map((genre) => h.li.children([genre]))),
              ]),
        ]),
      ]),
      ...(block.blurb === null
        ? []
        : [h.p.class('rich-content-music-blurb').children([block.blurb])]),
      ...(block.showTracks && music.tracks.length > 0
        ? [musicTracksView(h, music.title, music.tracks)]
        : []),
      ...(extras.musicActions ? [extras.musicActions(music)] : []),
      ...(music.links.length === 0
        ? []
        : [
            h.ul
              .class('rich-content-music-links')
              .attr('role', 'list')
              .attr('aria-label', 'Listen on')
              .children(
                music.links.map((link) =>
                  h.li.children([
                    h.a
                      .attrs(linkAttributes(link.url))
                      .attr(
                        'aria-label',
                        `Listen to ${credit} on ${musicPlatformLabel(link.platform)}${isOutbound(link.url) ? ' (opens in a new tab)' : ''}`,
                      )
                      .children([
                        musicPlatformIcon(h, link.platform, 'rich-content-music-link-icon'),
                        musicPlatformLabel(link.platform),
                      ]),
                  ]),
                ),
              ),
          ]),
    ])
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

const providerMark = <Message>(h: Html.H<Message>, provider: MediaProvider | null) =>
  h.span
    .class('rich-content-provider')
    .attrs(provider ? { 'data-provider': provider } : {})
    .children([
      h.span.class('rich-content-provider-dot').attr('aria-hidden', String(true)).children([]),
      provider ? mediaProviderLabels[provider] : 'Media',
    ])

const mediaView = <Message>(
  h: Html.H<Message>,
  block: Extract<RichContentBlock, { readonly _tag: 'ExternalMediaEmbed' }>,
): View.Content<Message> => {
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

  return h.figure
    .class('rich-content-media not-prose')
    .attr('data-provider', block.provider)
    .children([
      h.div
        .class('rich-content-media-frame')
        .style(
          height === null ? { aspectRatio: String(block.aspectRatio) } : { height: `${height}px` },
        )
        .children(
          players.map(({ src, theme }) =>
            h.iframe
              .attr('src', src)
              .attrs(theme ? { class: `rich-content-media-${theme}` } : {})
              .attr('title', `${label} player: ${block.title}`)
              .attr('width', '100%')
              .attr('height', '100%')
              .attr('loading', 'lazy')
              .attr('referrerpolicy', 'strict-origin-when-cross-origin')
              .attr('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture')
              .attr('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups')
              .children([]),
          ),
        ),
      h.figcaption.class('rich-content-media-source').children([
        providerMark(h, block.provider),
        h.a
          .attrs(linkAttributes(block.canonicalUrl))
          .attr('aria-label', `Open on ${label}`)
          .children([
            h.span.class('rich-content-media-host').children([hostOf(block.canonicalUrl)]),
            lucide(
              h,
              block.provider === 'youtube' ? iconPaths.youtube : iconPaths.externalLink,
              'rich-content-media-icon',
            ),
          ]),
      ]),
    ])
}

/** A link card for media whose player could not be resolved, so the post still reads well. */
const unavailableMediaView = <Message>(
  h: Html.H<Message>,
  block: Extract<RichContentBlock, { readonly _tag: 'UnavailableEmbed' }>,
): View.Content<Message> => {
  const provider = block.href === null ? null : providerOf(block.href)
  const label = provider ? mediaProviderLabels[provider] : null

  return h.aside
    .class('rich-content-link-card not-prose')
    .attrs(provider ? { 'data-provider': provider } : {})
    .children([
      h.div
        .class('rich-content-link-card-copy')
        .children([
          providerMark(h, provider),
          h.p
            .class('rich-content-link-card-title')
            .children([block.href === null ? 'Embedded media' : hostOf(block.href)]),
          h.p.class('rich-content-link-card-meta').children(['Player unavailable right now']),
        ]),
      block.href === null
        ? null
        : h.a
            .attrs(linkAttributes(block.href))
            .class('btn btn-sm')
            .children([
              label ? `Listen on ${label}` : 'Open link',
              lucide(
                h,
                provider === 'youtube' ? iconPaths.youtube : iconPaths.externalLink,
                'h-3 w-3',
              ),
            ]),
    ])
}

export const blockView = <Message, R = never>(
  h: Html.H<Message>,
  block: RichContentBlock,
  extras: BlockViewExtras<Message, R> = {},
): View.Content<Message, R> => {
  // oxlint-disable-next-line anti-slop-effect/no-manual-tag-comparison -- Schema-owned recursive unions have no generated matcher; this switch provides compile-time exhaustiveness.
  switch (block._tag) {
    case 'Paragraph':
      return h.p.children(inlineChildren(h, block.children))
    case 'Heading':
      return headingView(h, block)
    case 'List':
      return listView(h, block)
    case 'Quote':
      if (block.micro)
        return microView(h, block.micro, block.children, (child) => blockView(h, child))

      return h.blockquote.children(block.children.map((child) => blockView(h, child)))
    case 'Code':
      return h.pre.children([
        ...(block.language === null
          ? []
          : [h.span.class('rich-content-code-language').children([block.language])]),
        h.code.children([block.value]),
      ])
    case 'ThematicBreak':
      return h.hr
    case 'Table':
      return tableView(h, block)
    case 'MusicEmbed':
      return musicView(h, block, extras)
    case 'ExternalMediaEmbed':
      return mediaView(h, block)
    case 'Tracklist':
      return h.ol
        .class('rich-content-tracklist rich-content-track-list not-prose')
        .attr('role', 'list')
        .attr('aria-label', 'Tracklist')
        .children(
          block.tracks.map((track, index) =>
            h.li.children([
              h.span
                .class('rich-content-track-number')
                .attr('aria-hidden', String(true))
                .children([String(index + 1)]),
              h.span.class('rich-content-track-title').children([track.title]),
            ]),
          ),
        )
    case 'CardGroup':
      return h.div
        .class('rich-content-card-group')
        .attr('role', 'group')
        .attr('aria-label', 'Related music')
        .children(block.children.map((child) => blockView(h, child, extras)))
    case 'UnavailableEmbed':
      if (block.kind === 'media') return unavailableMediaView(h, block)

      return h.aside
        .class('rich-content-unavailable')
        .attr('role', 'status')
        .children([
          h.p.children([block.label]),
          ...(block.href === null
            ? []
            : [h.a.attrs(linkAttributes(block.href)).children(['Open the original content'])]),
        ])
    case 'Unsupported':
      return h.aside
        .class('rich-content-unsupported')
        .children([
          h.p.children([`Unsupported content (${block.reason})`]),
          h.pre.children([h.code.children([block.source])]),
        ])
    default:
      return unreachable(block)
  }
}

/** Maps a decoded rich-content document to inert Foldkit HTML without parsing source. */
export const richContentView = <Message>(
  h: Html.H<Message>,
  document: RichContentDocument,
  options: RichContentViewOptions = {},
): View.Content<Message> =>
  h.div
    .class(['rich-content', options.className].filter((value) => value !== undefined).join(' '))
    .children(document.blocks.map((block) => blockView(h, block)))
