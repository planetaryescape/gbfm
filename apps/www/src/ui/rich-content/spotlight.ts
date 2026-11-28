import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'
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

import { spotlightPresentation } from '../../domain/editorial/spotlight-presentation'
import type { Video } from '../../video'
import { iconPaths, pixelIcon, pixelPlayPath } from '../icons'
import { blockView, inlineChildren, type BlockViewExtras } from './render'
import { spotlightEnding } from './spotlight-ending'
import { spotlightRecords } from './spotlight-records'
import { spotlightReferences } from './spotlight-references'

export interface SpotlightViewOptions<Message, R = never> {
  readonly at: string | null
  readonly seen: ReadonlyArray<string>
  readonly direction?: 'none' | 'forward' | 'backward'
  readonly onStep: (at: string | null) => Message
  readonly onVideo: (video: Video) => Message
  readonly musicActions?: BlockViewExtras<Message, R>['musicActions']
  readonly onboarding?: View.Content<Message, R>
  readonly endArtwork?: View.Content<Message, R>
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
  h: Html.H<Message>,
  block: MediaBlock,
  id: string,
  { onVideo }: Pick<SpotlightViewOptions<Message>, 'onVideo'>,
): View.Content<Message> =>
  h.figure.class('spotlight-video not-prose').children([
    h.button
      .attr('type', 'button')
      .class('spotlight-video-poster')
      .style({ backgroundImage: posterLayers(id) })
      .attr('aria-label', `Play video: ${block.title}`)
      .on(
        'click',
        onVideo({
          embedUrl: autoplay(block.embedUrl),
          canonicalUrl: block.canonicalUrl,
          title: block.title,
        }),
      )
      .children([
        h.span
          .class('spotlight-video-play')
          .attr('aria-hidden', String(true))
          .children([pixelIcon(h, pixelPlayPath, 'h-6 w-6', true)]),
        h.span
          .class('spotlight-video-meta')
          .children([
            h.span.class('spotlight-video-source').children(['YouTube']),
            h.span.class('spotlight-video-title').children([block.title]),
          ]),
      ]),
  ])

const spotlightBlock =
  <Message, R>(h: Html.H<Message>, options: SpotlightViewOptions<Message, R>) =>
  (block: RichContentBlock) => {
    if (!Predicate.isTagged(block, 'ExternalMediaEmbed') || block.provider !== 'youtube')
      return blockView(h, block, { musicActions: options.musicActions })

    const id = youtubeVideoId(block.canonicalUrl)

    return id === null
      ? blockView(h, block, { musicActions: options.musicActions })
      : videoPoster(h, block, id, options)
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
  h: Html.H<Message>,
  steps: ReadonlyArray<SpotlightStep>,
  current: number,
  chapters: ReadonlyArray<SpotlightChapter>,
): View.Content<Message> => {
  const step = steps[current]

  let label = ''

  if (step?.kind === 'moment') {
    label = `${chapterName(chapters, step.chapter)} · ${step.position + 1} / ${chapters[step.chapter]?.moments.length ?? 0}`
  }

  if (step?.kind === 'chapter') {
    label = `Chapter ${step.chapter + 1} / ${chapters.length}`
  }

  return h.div.class('spotlight-progress not-prose').children([
    h.p.class('spotlight-progress-label').children([label]),
    h.div
      .class('sr-only')
      .attr('role', 'progressbar')
      .attr('aria-label', 'Reading progress')
      .attr('aria-valuemin', String(1))
      .attr('aria-valuemax', String(steps.length))
      .attr('aria-valuenow', String(current + 1))
      .children([]),
  ])
}

const stepView = <Message, R>(
  h: Html.H<Message>,
  step: SpotlightStep,
  render: (block: RichContentBlock) => View.Content<Message, R>,
  start: Message,
  onPosition: (at: string) => Message,
  onboarding: View.Content<Message, R>,
  ending: {
    readonly artwork?: View.Content<Message, R>
    readonly closing: ReadonlyArray<View.Content<Message, R>>
  },
) => {
  if (step.kind === 'intro')
    return h.div.class('spotlight-intro').children([
      ...step.blocks.map(render),
      onboarding,
      h.button
        .attr('type', 'button')
        .class('btn btn-primary spotlight-begin not-prose')
        .on('click', start)
        .children(['Start', pixelIcon(h, iconPaths.chevronRight, 'h-5 w-5')]),
    ])

  if (step.kind === 'end') return spotlightEnding(h, { ...ending, restart: start })

  if (step.kind === 'chapter')
    return h.div.class('spotlight-chapter').children([
      h.header
        .class('spotlight-chapter-head not-prose')
        .children([h.h2.children(inlineChildren(h, step.value.heading.children))]),
      ...step.value.lead.map(render),
      step.value.moments.length === 0
        ? h.text('')
        : h.ol
            .class('spotlight-chapter-moments not-prose')
            .attr('aria-label', 'In this chapter')
            .children(
              step.value.moments.map((moment, position) =>
                h.li.children([
                  h.button
                    .attr('type', 'button')
                    .class('spotlight-chapter-link')
                    .on('click', onPosition(`${step.chapter + 1}.${position + 1}`))
                    .children([headingText(moment.heading)]),
                ]),
              ),
            ),
    ])

  const references = spotlightReferences(h, step.value.blocks, render)

  return h.article
    .class('spotlight-moment')
    .children([
      h.h3.children(inlineChildren(h, step.value.heading.children)),
      ...spotlightRecords(h, step.value.blocks, references.render),
      references.styles,
    ])
}

const controlsView = <Message>(
  h: Html.H<Message>,
  steps: ReadonlyArray<SpotlightStep>,
  current: number,
  chapters: ReadonlyArray<SpotlightChapter>,
  onStep: (step: number) => Message,
): View.Content<Message> => {
  const next = steps[current + 1]

  return h.nav
    .class('spotlight-controls not-prose')
    .attr('aria-label', 'Move through the article')
    .children([
      h.button
        .attr('type', 'button')
        .class('btn btn-quiet btn-icon spotlight-back')
        .attr('disabled', current === 0 ? '' : undefined)
        .attr('aria-label', 'Previous entry')
        .attr('title', 'Previous (← / h)')
        .on('click', onStep(Math.max(current - 1, 0)))
        .children([pixelIcon(h, iconPaths.chevronLeft, 'h-5 w-5')]),
      h.button
        .attr('type', 'button')
        .class('btn btn-quiet btn-icon spotlight-next')
        .attr('disabled', next === undefined ? '' : undefined)
        .attr('aria-label', 'Next entry')
        .attr('title', next ? `Next (→ / l): ${stepLabel(next, chapters)}` : 'End of article')
        .on('click', onStep(Math.min(current + 1, steps.length - 1)))
        .children([pixelIcon(h, iconPaths.chevronRight, 'h-5 w-5')]),
    ])
}

/** Editorial reading layout that walks readers through one chapter opener or moment at a time. */
export const spotlightView = <Message, R = never>(
  h: Html.H<Message>,
  document: RichContentDocument,
  options: SpotlightViewOptions<Message, R>,
) => {
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

  return h.div
    .class('rich-content spotlight')
    .id('spotlight')
    .children([
      h.header
        .class('spotlight-header')
        .children([
          controlsView(h, steps, current, structure.chapters, go),
          progressView(h, steps, current, structure.chapters),
        ]),
      step
        ? h.div
            .class('spotlight-stage')
            .attr('data-direction', options.direction ?? 'none')
            .attr('role', 'region')
            .attr('aria-label', 'Current editorial entry')
            .attr('aria-live', 'polite')
            .attr('tabindex', String(0))
            .children([
              h.div
                .key(`spotlight-step-${current}`)
                .class('spotlight-step')
                .children([
                  stepView(
                    h,
                    step,
                    render,
                    go(current === steps.length - 1 ? 0 : 1),
                    options.onStep,
                    options.onboarding ?? h.text(''),
                    {
                      artwork: options.endArtwork,
                      closing: presentation.closing.map(render),
                    },
                  ),
                ]),
            ])
        : h.text(''),
    ])
}
