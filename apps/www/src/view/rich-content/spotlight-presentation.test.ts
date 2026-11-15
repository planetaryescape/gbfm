import { RichContentDocument } from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { spotlightPresentation } from './spotlight-presentation'

const document = (source: string) =>
  Schema.decodeUnknownSync(RichContentDocument)(parseRichContent(source).document)

describe('spotlightPresentation', () => {
  it('uses a leading standalone image as the banner without duplicating it in the intro', () => {
    const source = document(
      '![Record mosaic](https://example.com/banner.jpg)\n\nAn intro.\n\n## Zimbabwe',
    )

    const result = spotlightPresentation(source.blocks)

    expect(result.banner?.src).toBe('https://example.com/banner.jpg')
    expect(result.banner?.alt).toBe('Record mosaic')
    expect(result.blocks).toEqual(source.blocks.slice(1))
    expect(result.closing).toEqual([])
  })

  it('leaves inline or later images in the authored prose', () => {
    const source = document('An intro with ![Artwork](https://example.com/art.jpg).\n\n## Chapter')
    const result = spotlightPresentation(source.blocks)

    expect(result.banner).toBeNull()
    expect(result.blocks).toEqual(source.blocks)
  })

  it('moves explicitly separated closing prose to the ending without consuming later notes', () => {
    const source = document(
      '## Chapter\n\n### A record\n\nMy thoughts.\n\n---\n\nMore music soon.\n\n## Notes\n\nKeep these notes.',
    )

    const result = spotlightPresentation(source.blocks)

    expect(result.closing).toEqual(document('More music soon.').blocks)
    expect(result.blocks).toEqual(
      document('## Chapter\n\n### A record\n\nMy thoughts.\n\n## Notes\n\nKeep these notes.')
        .blocks,
    )
  })

  it('does not invent a closing section or move a separator without trailing prose', () => {
    const prose = document('## Chapter\n\n### A record\n\nA final thought.')
    expect(spotlightPresentation(prose.blocks).closing).toEqual([])

    const separator = document('## Chapter\n\nA thought.\n\n---\n\n## Another chapter')
    expect(spotlightPresentation(separator.blocks)).toEqual({
      banner: null,
      blocks: separator.blocks,
      closing: [],
    })
  })
})
