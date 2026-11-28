import { describe, expect, it } from 'vitest'

import { dateFilterHref } from './filters'

describe('native email date filters', () => {
  it('preserves audience and delivery filters while clearing pagination and a custom end date', () => {
    const href = dateFilterHref(
      'https://gbfm.test/dashboard/email-logs?status=BOUNCED&recipientEmail=fixture%40example.test&offset=25&dateTo=2026-11-26',
      '2026-11-19',
    )

    const query = new URL(href, 'https://gbfm.test').searchParams
    expect(query.get('status')).toBe('BOUNCED')
    expect(query.get('recipientEmail')).toBe('fixture@example.test')
    expect(query.get('offset')).toBeNull()
    expect(query.get('dateFrom')).toBe('2026-11-19')
    expect(query.get('dateTo')).toBeNull()
  })

  it('clears both bounds for all-time results without discarding a delivery filter', () => {
    expect(
      dateFilterHref(
        '/dashboard/email-logs?dateFrom=2026-11-19&dateTo=2026-11-26&status=SENT&offset=50',
        null,
      ),
    ).toBe('/dashboard/email-logs?status=SENT')
  })
})
