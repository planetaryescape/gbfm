import { describe, expect, test } from 'vitest'

import { attachLeadingBanner } from './banner'

const url = 'https://cdn.example.test/banner.png'

describe('leading editorial banner', () => {
  test('preserves layout and prose when inserting a banner', () => {
    expect(
      attachLeadingBanner('::layout{variant="spotlight"}\n\nIntro\n\n## Records', url, 'Art'),
    ).toBe(`::layout{variant="spotlight"}\n\n![Art](${url})\n\n\nIntro\n\n## Records`)
  })

  test('replaces only the first standalone image after layout', () => {
    const content =
      '::layout{variant="spotlight"}\n\n![Old](https://example.test/old.png)\n\nIntro\n\n![Keep](https://example.test/keep.png)'

    expect(attachLeadingBanner(content, url, 'New')).toBe(
      `::layout{variant="spotlight"}\n\n![New](${url})\n\nIntro\n\n![Keep](https://example.test/keep.png)`,
    )
  })

  test('does not remove a paragraph containing an inline image', () => {
    const content = 'Here ![Inline](https://example.test/inline.png) is prose.'
    expect(attachLeadingBanner(content, url, 'Art')).toBe(`![Art](${url})\n\n${content}`)
  })

  test('escapes Markdown alt text without adding another node', () => {
    expect(attachLeadingBanner('Prose', url, '[link](bad)')).toBe(
      `![\\[link\\]\\(bad\\)](${url})\n\nProse`,
    )
  })
})
