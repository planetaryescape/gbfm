import { expect, test } from 'vitest'

import { getSlugSuffix, stripSlugSuffix, toSlug } from './to-slug'

test('generates unique URL-safe slugs for the titles users submit', () => {
  const first = toSlug('Same Title')
  const second = toSlug('Same Title')
  expect(stripSlugSuffix(first)).toBe('same-title')
  expect(getSlugSuffix(first)).toMatch(/^[a-f0-9]{8}$/)
  expect(getSlugSuffix(second)).toMatch(/^[a-f0-9]{8}$/)
  expect(first).not.toBe(second)
  expect(stripSlugSuffix(first)).toBe(stripSlugSuffix(second))
  expect(stripSlugSuffix(toSlug('!!!'))).toBe('item')
})
