import { expect, test } from 'vitest'

import { microPostTags } from './micro-tags'

test('saves multiword hashtag paragraphs and explicit tags as canonical tags', () => {
  expect(microPostTags("I've been spamming this album\n\n#hip hop")).toEqual(['hip hop'])
  expect(
    microPostTags(
      'I\'ve been spamming this album\n\n::album{id="0ea9023d-cf10-4dcb-b85d-187a105f22ee" tracks="false"}\n\n#hip hop',
      ['hip-hop', 'ambient'],
    ),
  ).toEqual(['hip hop', 'ambient'])
  expect(microPostTags('#jazz #ambient\n\n#dub_techno')).toEqual(['jazz', 'ambient', 'dub techno'])
})

test('does not turn headings, prose, code, links, quotes or directives into tags', () => {
  expect(
    microPostTags(
      [
        '# hip hop',
        'Some #ambient music.',
        '```\n#jazz\n```',
        '`#bass`',
        '> #techno',
        '[#minimal](/somewhere)',
        '::track{id="37e48316-e87f-4131-896f-ceed0e3df1c6" genres="dub"}',
        '#not a tag sentence',
      ].join('\n\n'),
    ),
  ).toEqual([])
})
