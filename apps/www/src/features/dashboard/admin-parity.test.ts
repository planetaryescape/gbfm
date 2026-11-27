import { Locator, Scene } from '@effect/ui/testing'
import type { AdminOverviewResponse } from '@gbfm/api/admin'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { DashboardAdminPanelNoDeps, PanelMessage, SaveFeatured } from './admin-panels'
import { emptyDocument } from './document'
import { parseDashboardDocument } from './projection'
import { DashboardRequestError } from './service'

const principal = { id: 'admin', name: null, username: null, role: 'admin' }

const breakdown = { published: 0, drafts: 0, newLast7Days: 0 }

const overview: typeof AdminOverviewResponse.Type = {
  generatedAt: '2026-11-26T00:00:00Z',
  highlights: {
    totalUsers: 1204,
    verifiedUsers: 980,
    newsletterSubscribers: 12,
    totalPlayCount: 54321,
    publishedMixes: 88,
    newUsersLast7Days: 3,
    newSubscribersLast30Days: 0,
    newMixesLast30Days: 4,
  },
  publishing: {
    mixes: breakdown,
    tracks: breakdown,
    miscAudio: breakdown,
    shows: breakdown,
    posts: breakdown,
    micros: breakdown,
    labels: breakdown,
    releases: breakdown,
    recentContent: [],
    topMixes: [],
  },
  community: {
    users: {
      total: 0,
      verified: 0,
      admins: 0,
      editors: 0,
      creators: 0,
      banned: 0,
      newLast7Days: 0,
      newLast30Days: 0,
    },
    sessions: { active: 0 },
    newsletter: { total: 0, newLast7Days: 0, newLast30Days: 0 },
    engagement: { favoritesTotal: 0, showSubscriptionsTotal: 0 },
    recentUsers: [],
    recentSubscribers: [],
  },
  operations: {
    emails: {
      total: 0,
      sent: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      failed: 0,
      pending: 0,
      failedLast7Days: 0,
      recentFailures: [],
    },
    reminders: { pending: 0, processing: 0, failed: 0, dueNow: 0 },
  },
}

describe('native admin projection and controls parity', () => {
  it('labels every overview highlight for people and formats its count', async () => {
    const document = await Effect.runPromise(
      parseDashboardDocument('/api/admin/overview', overview),
    )

    expect(document.rows.map((row) => `${row.title}: ${row.detail}`)).toEqual([
      'Users: 1,204',
      'Verified users: 980',
      'Subscribers: 12',
      'Total plays: 54,321',
      'Published mixes: 88',
      'New users (7 days): 3',
      'New subscribers (30 days): 0',
      'New mixes (30 days): 4',
    ])
  })

  it('allows replacing an unavailable featured mix with automatic selection', async () => {
    const document = await Effect.runPromise(
      parseDashboardDocument('/api/admin/featured-mix', {
        mixId: 'retired',
        unavailableTitle: 'Retired mix',
        mixes: [{ id: 'newest', title: 'Newest mix' }],
      }),
    )

    expect(document.fields).toEqual({
      mixId: 'retired',
      savedMixId: 'retired',
      unavailableTitle: 'Retired mix',
    })
    expect(document.rows.map(({ id }) => id)).toEqual(['newest'])
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardAdminPanelNoDeps, {
            principal,
            section: 'featured-mix',
            url: '/dashboard/featured-mix',
            initialDocument: document,
          })

          s.fire(Locator.tag('select'), 'change', { value: '' }).click('Save featured mix')
          const command = SaveFeatured.make({ mixId: null })
          s.expectExact(command)
          s.resolve(command, PanelMessage.SucceededSaveFeatured()).loaded('document', {
            ...document,
            fields: { mixId: '', savedMixId: '', unavailableTitle: '' },
          })
          expect(s.current.query(Locator.text('Featured mix saved.'))).toBeDefined()
        }),
      ),
    )
  })

  it('renders parsed app connections and the owned disconnect form', async () => {
    const document = await Effect.runPromise(
      parseDashboardDocument('/api/user/mcp-connections', {
        connections: [
          {
            clientId: 'disposable-client',
            name: 'Disposable editor',
            scopes: ['posts:read'],
            createdAt: '2026-11-04T00:00:00Z',
          },
        ],
      }),
    )

    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardAdminPanelNoDeps, {
            principal,
            section: 'connections',
            url: '/dashboard/connections',
            initialDocument: document,
          })

          expect(s.current.query(Locator.text('Disposable editor'))).toBeDefined()
          expect(s.current.query(Locator.text('Disconnect', { exact: true }))).toBeDefined()
          expect(
            s.current.query(Locator.attr('action', '/actions/connections/revoke')),
          ).toBeDefined()
        }),
      ),
    )
  })

  it('distinguishes empty successful connections from an unavailable endpoint', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardAdminPanelNoDeps, {
            principal,
            section: 'connections',
            url: '/dashboard/connections',
            initialDocument: { ...emptyDocument, connections: [] },
          })

          expect(s.current.query(Locator.text('No connected apps.'))).toBeDefined()
          expect(
            s.current.query(
              Locator.text('App connections are not available for this account or environment.'),
            ),
          ).toBeUndefined()
        }),
      ),
    ))

  it('distinguishes a pending connection refresh from a retryable failure and recovers on retry', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardAdminPanelNoDeps, {
            principal,
            section: 'connections',
            url: '/dashboard/connections',
            initialDocument: { ...emptyDocument, connections: [] },
          })

          s.click('Refresh')
          expect(s.current.query(Locator.text('Loading connections…'))).toBeDefined()
          s.loadFailed(
            'document',
            new DashboardRequestError({ status: 500, message: 'Unavailable' }),
          )
          expect(s.current.query(Locator.attr('role', 'alert'))).toBeDefined()
          s.click('Refresh').loaded('document', { ...emptyDocument, connections: [] })
          expect(s.current.query(Locator.attr('role', 'alert'))).toBeUndefined()
          expect(s.current.query(Locator.text('No connected apps.'))).toBeDefined()
        }),
      ),
    ))
})
