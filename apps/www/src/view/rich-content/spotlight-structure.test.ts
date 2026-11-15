import { RichContentDocument, type RichContentBlock } from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { spotlightStructure, youtubeVideoId } from './spotlight-structure'

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
