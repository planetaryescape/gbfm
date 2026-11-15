import { RichContentDocument, type RichContentBlock } from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  spotlightSteps,
  spotlightStructure,
  stepAt,
  stepPosition,
  youtubeVideoId,
} from './spotlight-structure'

const text = (block: RichContentBlock | undefined) =>
  block && 'children' in block && Array.isArray(block.children)
    ? block.children.map((child) => ('value' in child ? child.value : '')).join('')
    : null

describe('spotlightStructure', () => {
  const { document } = parseRichContent(
    [
      'Intro paragraph.',
      '## Zimbabwe',
      'Chapter lead.',
      '### Tuku',
      'Matope has such a nice tempo to it.',
      '#### Aside',
      'Still part of Tuku.',
      '### Mukanya',
      'Possibly my all-time favourite.',
      '## London',
      '### Welcome to the Hills',
      'Drums.',
    ].join('\n\n'),
  )

  const structure = spotlightStructure(
    Schema.decodeUnknownSync(RichContentDocument)(document).blocks,
  )

  it('keeps blocks before the first chapter as the intro', () => {
    expect(structure.intro.map(text)).toEqual(['Intro paragraph.'])
  })

  it('opens a chapter at each second-level heading', () => {
    expect(structure.chapters.map((chapter) => text(chapter.heading))).toEqual([
      'Zimbabwe',
      'London',
    ])
    expect(structure.chapters[0]?.lead.map(text)).toEqual(['Chapter lead.'])
  })

  it('groups everything under a third-level heading into its moment', () => {
    const [tuku, mukanya] = structure.chapters[0]?.moments ?? []

    expect(text(tuku?.heading)).toBe('Tuku')
    expect(tuku?.blocks.map(text)).toEqual([
      'Matope has such a nice tempo to it.',
      'Aside',
      'Still part of Tuku.',
    ])
    expect(text(mukanya?.heading)).toBe('Mukanya')
  })
})

describe('youtubeVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=1g826StJhLk', '1g826StJhLk'],
    ['https://youtu.be/5FwY5uHswwM', '5FwY5uHswwM'],
    ['https://www.youtube-nocookie.com/embed/czrPRJehmdA', 'czrPRJehmdA'],
    ['not a url', null],
  ])('reads %s', (href, id) => {
    expect(youtubeVideoId(href)).toBe(id)
  })
})

describe('spotlightSteps', () => {
  it('walks intro, each chapter opener and its moments, then the end', () => {
    const { document } = parseRichContent(
      [
        'Intro.',
        '## Zimbabwe',
        '### Tuku',
        'Matope.',
        '### Mukanya',
        'Jairosi.',
        '## London',
        '### Hills',
        'Drums.',
      ].join('\n\n'),
    )

    const steps = spotlightSteps(
      spotlightStructure(Schema.decodeUnknownSync(RichContentDocument)(document).blocks),
    )

    expect(
      steps.map((step) =>
        step.kind === 'moment' ? `${step.chapter}.${step.position}` : step.kind,
      ),
    ).toEqual(['intro', 'chapter', '0.0', '0.1', 'chapter', '1.0', 'end'])
  })
})

describe('step positions', () => {
  const { document } = parseRichContent(
    ['Intro.', '## Zimbabwe', '### Tuku', 'Matope.'].join('\n\n'),
  )

  const steps = spotlightSteps(
    spotlightStructure(Schema.decodeUnknownSync(RichContentDocument)(document).blocks),
  )

  it('round-trips every step through its URL position', () => {
    expect(steps.map(stepPosition)).toEqual([null, '1', '1.1', 'end'])
    expect(steps.map((step) => stepAt(steps, stepPosition(step)))).toEqual([0, 1, 2, 3])
  })

  it('falls back to the intro for positions the post no longer has', () => {
    expect(stepAt(steps, '9.9')).toBe(0)
  })
})
