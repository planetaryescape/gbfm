import { describe, expect, it } from 'vitest'

import { formatScrubberDelta, formatScrubberTime } from './scrubberTime'

describe('scrubber time labels', () => {
  it('uses minutes and seconds for short tracks', () => {
    expect(formatScrubberTime(0, 3599)).toBe('0:00')
    expect(formatScrubberTime(65.9, 3599)).toBe('1:05')
    expect(formatScrubberTime(3599, 3599)).toBe('59:59')
  })

  it('keeps the hours field on both sides of the hour boundary for long tracks', () => {
    expect(formatScrubberTime(0, 3600)).toBe('0:00:00')
    expect(formatScrubberTime(3599, 7200)).toBe('0:59:59')
    expect(formatScrubberTime(3600, 7200)).toBe('1:00:00')
    expect(formatScrubberTime(36000, 72000)).toBe('10:00:00')
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'handles unsafe seconds and durations %s',
    (invalid) => {
      expect(formatScrubberTime(invalid, 7200)).toBe('0:00:00')
      expect(formatScrubberTime(65, invalid)).toBe('1:05')
      expect(formatScrubberDelta(invalid, invalid, 7200)).toBe('+0:00:00')
    },
  )

  it('shows signed deltas with the same duration-aware format', () => {
    expect(formatScrubberDelta(65, 60, 120)).toBe('+0:05')
    expect(formatScrubberDelta(55, 60, 120)).toBe('-0:05')
    expect(formatScrubberDelta(60, 60, 7200)).toBe('+0:00:00')
    expect(formatScrubberDelta(3601, 0, 7200)).toBe('+1:00:01')
    expect(formatScrubberDelta(0, 3601, 7200)).toBe('-1:00:01')
  })
})
