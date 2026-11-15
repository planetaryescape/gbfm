import type { RichContentBlock, RichContentDocument } from '@gbfm/rich-content/schema'
import {
  headingText,
  spotlightSteps,
  spotlightStructure,
  stepAt,
  stepPosition,
  youtubeVideoId,
  type SpotlightChapter,
  type SpotlightStep,
} from '@gbfm/rich-content/spotlight'
import { Predicate } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Video } from '../../video'
import { iconPaths, pixelIcon, pixelPlayPath } from '../icons'
import { blockView, inlineChildren, type BlockViewExtras } from './render'
import { spotlightEnding } from './spotlight-ending'
import { spotlightPresentation } from './spotlight-presentation'
import { spotlightRecords } from './spotlight-records'
import { spotlightReferences } from './spotlight-references'

export interface SpotlightViewOptions<Message> {
  readonly at: string | null
  readonly seen: ReadonlyArray<string>
  readonly direction?: 'none' | 'forward' | 'backward'
  readonly onStep: (at: string | null) => Message
  readonly onVideo: (video: Video) => Message
  readonly musicActions?: BlockViewExtras['musicActions']
  readonly onboarding?: Html
  readonly endArtwork?: Html
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
            [pixelIcon(pixelPlayPath, 'h-6 w-6', true)],
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
      return blockView(block, h, { musicActions: options.musicActions })

    const id = youtubeVideoId(block.canonicalUrl)

    return id === null
      ? blockView(block, h, { musicActions: options.musicActions })
      : videoPoster(block, id, h, options)
  }

const chapterName = (chapters: ReadonlyArray<SpotlightChapter>, index: number) => {
  const chapter = chapters[index]

  return chapter ? headingText(chapter.heading) : ''
}

const stepLabel = (step: SpotlightStep, chapters: ReadonlyArray<SpotlightChapter>): string => {
  if (step.kind === 'intro') return 'Intro'

  if (step.kind === 'end') return 'The end'

  const name = chapterName(chapters, step.chapter)

  return step.kind === 'chapter'
    ? `Chapter ${step.chapter + 1} · ${name}`
    : headingText(step.value.heading)
}

const progressView = <Message>(
  steps: ReadonlyArray<SpotlightStep>,
  current: number,
  chapters: ReadonlyArray<SpotlightChapter>,
  h: HtmlBuilder<Message>,
): Html => {
  const step = steps[current]

  let label = ''

  if (step?.kind === 'moment') {
    label = `${chapterName(chapters, step.chapter)} · ${step.position + 1} / ${chapters[step.chapter]?.moments.length ?? 0}`
  }

  if (step?.kind === 'chapter') {
    label = `Chapter ${step.chapter + 1} / ${chapters.length}`
  }

  return h.div(
    [h.Class('spotlight-progress not-prose')],
    [
      h.p([h.Class('spotlight-progress-label')], [label]),
      h.div(
        [
          h.Class('sr-only'),
          h.Role('progressbar'),
          h.AriaLabel('Reading progress'),
          h.AriaValuemin(1),
          h.AriaValuemax(steps.length),
          h.AriaValuenow(current + 1),
        ],
        [],
      ),
    ],
  )
}

const stepView = <Message>(
  step: SpotlightStep,
  h: HtmlBuilder<Message>,
  render: (block: RichContentBlock) => Html,
  start: Message,
  onPosition: (at: string) => Message,
  onboarding: Html,
  ending: { readonly artwork?: Html; readonly closing: ReadonlyArray<Html> },
): Html => {
  if (step.kind === 'intro')
    return h.div(
      [h.Class('spotlight-intro')],
      [
        ...step.blocks.map(render),
        onboarding,
        h.button(
          [
            h.Type('button'),
            h.Class('btn btn-primary spotlight-begin not-prose'),
            h.OnClick(start),
          ],
          ['Start', pixelIcon(iconPaths.chevronRight, 'h-5 w-5')],
        ),
      ],
    )

  if (step.kind === 'end') return spotlightEnding(h, { ...ending, restart: start })

  if (step.kind === 'chapter')
    return h.div(
      [h.Class('spotlight-chapter')],
      [
        h.header(
          [h.Class('spotlight-chapter-head not-prose')],
          [h.h2([], inlineChildren(step.value.heading.children, h))],
        ),
        ...step.value.lead.map(render),
        step.value.moments.length === 0
          ? h.empty
          : h.ol(
              [h.Class('spotlight-chapter-moments not-prose'), h.AriaLabel('In this chapter')],
              step.value.moments.map((moment, position) =>
                h.li(
                  [],
                  [
                    h.button(
                      [
                        h.Type('button'),
                        h.Class('spotlight-chapter-link'),
                        h.OnClick(onPosition(`${step.chapter + 1}.${position + 1}`)),
                      ],
                      [headingText(moment.heading)],
                    ),
                  ],
                ),
              ),
            ),
      ],
    )

  const references = spotlightReferences(step.value.blocks, h, render)

  return h.article(
    [h.Class('spotlight-moment')],
    [
      h.h3([], inlineChildren(step.value.heading.children, h)),
      ...spotlightRecords(step.value.blocks, h, references.render),
      references.styles,
    ],
  )
}

const controlsView = <Message>(
  steps: ReadonlyArray<SpotlightStep>,
  current: number,
  chapters: ReadonlyArray<SpotlightChapter>,
  h: HtmlBuilder<Message>,
  onStep: (step: number) => Message,
): Html => {
  const next = steps[current + 1]

  return h.nav(
    [h.Class('spotlight-controls not-prose'), h.AriaLabel('Move through the article')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('btn btn-quiet btn-icon spotlight-back'),
          h.Disabled(current === 0),
          h.AriaLabel('Previous entry'),
          h.Title('Previous (← / h)'),
          h.OnClick(onStep(Math.max(current - 1, 0))),
        ],
        [pixelIcon(iconPaths.chevronLeft, 'h-5 w-5')],
      ),
      h.button(
        [
          h.Type('button'),
          h.Class('btn btn-quiet btn-icon spotlight-next'),
          h.Disabled(next === undefined),
          h.AriaLabel('Next entry'),
          h.Title(next ? `Next (→ / l): ${stepLabel(next, chapters)}` : 'End of article'),
          h.OnClick(onStep(Math.min(current + 1, steps.length - 1))),
        ],
        [pixelIcon(iconPaths.chevronRight, 'h-5 w-5')],
      ),
    ],
  )
}

/** Editorial reading layout that walks readers through one chapter opener or moment at a time. */
export const spotlightView = <Message>(
  document: RichContentDocument,
  h: HtmlBuilder<Message>,
  options: SpotlightViewOptions<Message>,
): Html => {
  const presentation = spotlightPresentation(document.blocks)
  const structure = spotlightStructure(presentation.blocks)
  const steps = spotlightSteps(structure)
  const current = stepAt(steps, options.at)

  const go = (index: number) => {
    const target = steps[index]

    return options.onStep(target ? stepPosition(target) : null)
  }

  const step = steps[current]
  const render = spotlightBlock(h, options)

  return h.div(
    [h.Class('rich-content spotlight'), h.Id('spotlight')],
    [
      h.header(
        [h.Class('spotlight-header')],
        [
          controlsView(steps, current, structure.chapters, h, go),
          progressView(steps, current, structure.chapters, h),
        ],
      ),
      step
        ? h.div(
            [
              h.Class('spotlight-stage'),
              h.DataAttribute('direction', options.direction ?? 'none'),
              h.Role('region'),
              h.AriaLabel('Current editorial entry'),
              h.AriaLive('polite'),
              h.Tabindex(0),
            ],
            [
              h.div(
                [h.Key(`spotlight-step-${current}`), h.Class('spotlight-step')],
                [
                  stepView(
                    step,
                    h,
                    render,
                    go(current === steps.length - 1 ? 0 : 1),
                    options.onStep,
                    options.onboarding ?? h.empty,
                    {
                      artwork: options.endArtwork,
                      closing: presentation.closing.map(render),
                    },
                  ),
                ],
              ),
            ],
          )
        : h.empty,
    ],
  )
}
