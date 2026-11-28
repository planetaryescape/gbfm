import { describe, expect, it } from 'vitest'

import {
  absoluteTime,
  activeDatePreset,
  daysAgoDate,
  filterHref,
  pageRange,
  plural,
  relativeTimeLabel,
} from '../../features/dashboard/formatting'

const now = Date.parse('2026-10-23T12:00:00.000Z')

describe('relativeTimeLabel', () => {
  it('says just now for anything under a minute either way', () => {
    expect(relativeTimeLabel('2026-10-23T11:59:30.000Z', now)).toBe('just now')
    expect(relativeTimeLabel('2026-10-23T12:00:20.000Z', now)).toBe('just now')
  })

  it('uses minutes, hours and days for the past', () => {
    expect(relativeTimeLabel('2026-10-23T11:55:00.000Z', now)).toBe('5m ago')
    expect(relativeTimeLabel('2026-10-23T09:00:00.000Z', now)).toBe('3h ago')
    expect(relativeTimeLabel('2026-10-21T12:00:00.000Z', now)).toBe('2d ago')
  })

  it('counts forward for future times', () => {
    expect(relativeTimeLabel('2026-10-23T15:30:00.000Z', now)).toBe('in 3h')
    expect(relativeTimeLabel('2026-10-30T12:00:00.000Z', now)).toBe('in 7d')
  })

  it('falls back to the calendar date after a month', () => {
    expect(relativeTimeLabel('2026-08-01T12:00:00.000Z', now)).toBe('01 Aug 2026')
  })

  it('returns unparseable input unchanged', () => {
    expect(relativeTimeLabel('not a date', now)).toBe('not a date')
  })
})

describe('absoluteTime', () => {
  it('formats in Johannesburg time', () => {
    expect(absoluteTime('2026-10-23T12:00:00.000Z')).toBe('23 Oct 2026, 14:00')
  })
})

describe('plural', () => {
  it('picks the singular only for one', () => {
    expect(plural(1, 'attempt')).toBe('1 attempt')
    expect(plural(0, 'attempt')).toBe('0 attempts')
    expect(plural(1200, 'address', 'addresses')).toBe('1,200 addresses')
  })
})

describe('pageRange', () => {
  it('describes the visible slice of the total', () => {
    expect(pageRange(0, 25, 132)).toBe('1 to 25 of 132')
    expect(pageRange(125, 7, 132)).toBe('126 to 132 of 132')
  })

  it('never runs past the total', () => {
    expect(pageRange(0, 30, 20)).toBe('1 to 20 of 20')
  })

  it('reports an empty result', () => {
    expect(pageRange(0, 0, 0)).toBe('No results')
  })
})

describe('daysAgoDate', () => {
  it('returns the UTC calendar date N days back', () => {
    expect(daysAgoDate(1, now)).toBe('2026-10-22')
    expect(daysAgoDate(30, now)).toBe('2026-09-23')
  })
})

describe('filterHref', () => {
  it('changes one filter, keeps the rest and returns to the first page', () => {
    const query = new URLSearchParams({ recipientEmail: 'a@b.test', status: 'SENT', offset: '25' })

    expect(filterHref('/dashboard/email-logs', query, { status: 'FAILED' })).toBe(
      '/dashboard/email-logs?recipientEmail=a%40b.test&status=FAILED',
    )
  })

  it('drops cleared filters and the query string when nothing is left', () => {
    const query = new URLSearchParams({ status: 'SENT' })

    expect(filterHref('/dashboard/email-logs', query, { status: null })).toBe(
      '/dashboard/email-logs',
    )
  })
})

describe('activeDatePreset', () => {
  it('reports all time when no dates are set', () => {
    expect(activeDatePreset('', '', now)).toBe(null)
  })

  it('recognises a preset start date', () => {
    expect(activeDatePreset('2026-10-16', '', now)).toBe(7)
  })

  it('treats any other range as custom', () => {
    expect(activeDatePreset('2026-09-26', '', now)).toBe('custom')
    expect(activeDatePreset('2026-10-16', '2026-10-20', now)).toBe('custom')
    expect(activeDatePreset('', '2026-10-20', now)).toBe('custom')
  })
})
