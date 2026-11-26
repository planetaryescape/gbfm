import { expect, test } from 'vitest'

import { canonicalContentTag, canonicalContentTags, contentTagAliases } from './content-tags'

test('canonicalizes only the approved tag families and deduplicates in order', () => {
  expect(
    canonicalContentTags([
      'hip-hop',
      'hip_hop',
      'Hip Hop',
      'hiphop',
      'dub_techno',
      'dub-techno',
      'minima',
      'minimal',
      'curated',
      'curation',
      'dub',
      'juke',
      'footwork',
    ]),
  ).toEqual(['hip hop', 'dub techno', 'minimal', 'curated', 'curation', 'dub', 'juke', 'footwork'])
  expect(canonicalContentTag(canonicalContentTag('hip_hop'))).toBe('hip hop')
  expect(contentTagAliases('hip-hop')).toContain('hip hop')
  expect(contentTagAliases('curated')).toEqual(['curated'])
})
