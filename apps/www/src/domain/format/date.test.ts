import { expect, it } from 'vitest'

import { formatDate } from './date'

it('formats the UTC calendar day independently of the input offset', () => {
  expect(formatDate('2026-01-01T23:30:00-02:00')).toBe('Jan 2, 2026')
  expect(formatDate('2026-01-02T01:30:00Z')).toBe('Jan 2, 2026')
})
