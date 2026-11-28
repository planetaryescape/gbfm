import { Locator, Scene } from '@effect/ui/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { DashboardAdminPanelNoDeps, PanelMessage, ReadPanelClock } from './admin-panels'
import { emptyDocument } from './document'
import { ReadTimestampClock, Timestamp, TimestampMessage } from './timestamp'

const now = Date.parse('2026-10-23T12:00:00.000Z')

const principal = { id: 'fixture-admin', name: null, username: null, role: 'admin' }

describe('native canonical formatting bindings', () => {
  it('renders a semantic relative timestamp with the Johannesburg absolute tooltip', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const iso = '2026-10-23T11:55:00.000Z'
          const s = yield* Scene.make(Timestamp, { iso })
          s.resolve(ReadTimestampClock, TimestampMessage.CompletedClock({ now }))
          expect(s.current.query(Locator.text('5m ago'))).toBeDefined()
          expect(s.current.query(Locator.attr('datetime', iso))).toBeDefined()
          expect(s.current.query(Locator.attr('title', '23 Oct 2026, 13:55'))).toBeDefined()
        }),
      ),
    ))

  it.each([
    { query: '', label: 'All time' },
    { query: '?dateFrom=2026-10-16', label: '7 days' },
    { query: '?dateFrom=2026-10-16&dateTo=2026-10-20', label: null },
  ])('classifies the actual email date controls for $query', ({ query, label }) =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardAdminPanelNoDeps, {
            principal,
            section: 'email-logs',
            url: `/dashboard/email-logs${query}`,
            initialDocument: emptyDocument,
          })

          s.resolve(ReadPanelClock, PanelMessage.CompletedReadPanelClock({ now }))

          const active = s.current.query(
            Locator.inside(
              Locator.attr('aria-label', 'Email date range'),
              Locator.attr('aria-current', 'true'),
            ),
          )

          if (label === null) {
            expect(active).toBeUndefined()
            expect(s.current.query(Locator.text('Clear dates'))).toBeDefined()
          } else {
            expect(active).toBeDefined()

            if (active) expect(Locator.textOf(active)).toBe(label)
          }
        }),
      ),
    ),
  )
})
