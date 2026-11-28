import { expect, test } from 'vitest'

import { monthLabel, monthOf, relativeAge, timelineMonths } from '../../features/reader/timeline'

test('fills calendar gaps newest first', () => {
  const months = timelineMonths([
    { month: '2023-12', total: 2, unread: 0, newestSlug: 'december' },
    { month: '2025-02', total: 1, unread: 1, newestSlug: 'february' },
    { month: '2025-06', total: 3, unread: 2, newestSlug: 'june' },
  ])

  expect(months).toHaveLength(19)
  expect(months[0]?.month).toBe('2025-06')
  expect(months.at(-1)?.month).toBe('2023-12')
  expect(months[1]).toEqual({ month: '2025-05', total: 0, unread: 0, newestSlug: null })
  expect(timelineMonths([])).toEqual([])
})

test('months are read in UTC and labelled for display', () => {
  expect(monthOf('2024-03-01T00:30:00+02:00')).toBe('2024-02')
  expect(monthLabel('2024-02')).toBe('Feb 2024')
})

test('relative age uses the supplied render time rather than ambient client time', () => {
  const now = Date.parse('2026-09-25T12:00:00Z')
  expect(relativeAge('2026-09-25T08:00:00Z', now)).toBe('today')
  expect(relativeAge('2026-09-20T08:00:00Z', now)).toBe('5 days ago')
  expect(relativeAge('2024-09-01T08:00:00Z', now)).toBe('2 years ago')
})
