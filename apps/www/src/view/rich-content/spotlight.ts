import type { RichContentBlock, RichContentDocument } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Video } from '../../video'
import { iconPaths, lucide } from '../icons'
import { blockView, inlineChildren } from './render'
import { spotlightStructure, youtubeVideoId, type SpotlightMoment } from './spotlight-structure'

export interface SpotlightViewOptions<Message> {
  readonly onVideo: (video: Video) => Message
}

type MediaBlock = Extract<RichContentBlock, { readonly _tag: 'ExternalMediaEmbed' }>

const posterLayers = (id: string) =>
  `url(https://i.ytimg.com/vi/${id}/maxresdefault.jpg), url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)`

const autoplay = (embedUrl: string) => {
  const url = new URL(embedUrl)

  url.searchParams.set('autoplay', '1')
  url.searchParams.set('rel', '0')

  return url.href
}

const videoPoster = <Message>(
  block: MediaBlock,
  id: string,
  h: HtmlBuilder<Message>,
  { onVideo }: SpotlightViewOptions<Message>,
): Html =>
  h.figure(
    [h.Class('spotlight-video not-prose')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('spotlight-video-poster'),
          h.Style({ backgroundImage: posterLayers(id) }),
          h.AriaLabel(`Play video: ${block.title}`),
          h.OnClick(
            onVideo({
              embedUrl: autoplay(block.embedUrl),
              canonicalUrl: block.canonicalUrl,
              title: block.title,
            }),
          ),
        ],
        [
          h.span(
            [h.Class('spotlight-video-play'), h.AriaHidden(true)],
            [lucide(iconPaths.play, 'h-7 w-7 fill-current')],
          ),
          h.span(
            [h.Class('spotlight-video-meta')],
            [
              h.span([h.Class('spotlight-video-source')], ['YouTube']),
              h.span([h.Class('spotlight-video-title')], [block.title]),
            ],
          ),
        ],
      ),
    ],
  )

const spotlightBlock =
  <Message>(h: HtmlBuilder<Message>, options: SpotlightViewOptions<Message>) =>
  (block: RichContentBlock): Html => {
    if (!Predicate.isTagged(block, 'ExternalMediaEmbed') || block.provider !== 'youtube')
      return blockView(block, h)

    const id = youtubeVideoId(block.canonicalUrl)

    return id === null ? blockView(block, h) : videoPoster(block, id, h, options)
  }

const momentView = <Message>(
  moment: SpotlightMoment,
  h: HtmlBuilder<Message>,
  render: (block: RichContentBlock) => Html,
): Html =>
  h.article(
    [h.Class('spotlight-moment')],
    [h.h3([], inlineChildren(moment.heading.children, h)), ...moment.blocks.map(render)],
  )

/** Editorial reading layout that walks readers chapter by chapter and lights the moment in view. */
export const spotlightView = <Message>(
  document: RichContentDocument,
  h: HtmlBuilder<Message>,
  options: SpotlightViewOptions<Message>,
): Html => {
  const { intro, chapters } = spotlightStructure(document.blocks)
  const render = spotlightBlock(h, options)

  return h.div(
    [h.Class('rich-content spotlight')],
    [
      ...intro.map(render),
      ...chapters.map((chapter, index) => {
        const name = inlineChildren(chapter.heading.children, h)

        return h.section(
          [h.Class('spotlight-chapter')],
          [
            h.header(
              [h.Class('spotlight-chapter-head not-prose')],
              [
                h.p([h.Class('spotlight-chapter-eyebrow')], [`Chapter ${index + 1}`]),
                h.h2([], name),
              ],
            ),
            ...chapter.lead.map(render),
            ...chapter.moments.map((moment) => momentView(moment, h, render)),
          ],
        )
      }),
    ],
  )
}
