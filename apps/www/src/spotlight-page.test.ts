import { RichContentDocument } from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { normalizeSpotlightProgress } from './spotlight-page'

const document = Schema.decodeUnknownSync(RichContentDocument)(
  parseRichContent('Intro.\n\n## Chapter\n\n### Record\n\nA thought.').document,
)

describe('spotlight progress normalization', () => {
  it.each(['', '2.3', 'garbage', '0', '1.999', null])(
    'resolves %s to the intro and removes obsolete seen positions',
    (at) => {
      expect(
        normalizeSpotlightProgress(document, {
          path: '/editorial/fixture',
          at,
          seen: ['intro', '1', '1.1', '2.3'],
        }),
      ).toEqual({
        path: '/editorial/fixture',
        at: null,
        seen: ['intro', '1', '1.1'],
      })
    },
  )

  it.each(['1', '1.1', 'end'])('preserves valid position %s idempotently', (at) => {
    const progress = { path: '/editorial/fixture', at, seen: [at] }
    expect(normalizeSpotlightProgress(document, progress)).toEqual(progress)
    expect(
      normalizeSpotlightProgress(document, normalizeSpotlightProgress(document, progress)),
    ).toEqual(progress)
  })
})
