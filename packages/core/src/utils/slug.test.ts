import { expect, test } from 'vitest'

import { normalizeSlugBase } from './slug'

test('normalizes and bounds a slug base', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['Burial', 'burial'],
    ['Four Tet', 'four-tet'],
    ['Burial & Four Tet!', 'burial-four-tet'],
    ['Burial --- Four Tet', 'burial-four-tet'],
    ['---Burial---', 'burial'],
    ['Björk', 'bj-rk'],
    ['Album 2024', 'album-2024'],
    ['!!!', ''],
  ]

  for (const [title, expected] of cases) expect(normalizeSlugBase(title)).toBe(expected)

  const slug = normalizeSlugBase(
    'This is a very long title that should not keep going forever in the generated slug',
  )

  expect(slug).toBe('this-is-a-very-long-title-that-s')
})
