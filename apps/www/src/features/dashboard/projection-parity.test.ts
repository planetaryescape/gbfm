import { Locator, Scene, Story } from '@effect/ui/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { CollectionMessage, DashboardCollectionNoDeps, RemoveSavedItem } from './collection'
import { parseDashboardDocument } from './projection'
import { endpointFor } from './sections'

const principal = { id: 'listener', name: null, username: null, role: 'user' }

const reminder = {
  id: 'reminder',
  commandRevision: 8,
  userId: 'listener',
  musicTitle: 'Fixture',
  artistName: 'Artist',
  musicUrl: 'https://example.test/music',
  albumCoverUrl: null,
  reminderDate: '2099-11-12T10:00:00Z',
  notes: null,
  createdAt: '2026-11-09T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
}

describe('legacy collection projection parity through native components', () => {
  it('retains audio/show artwork and readable unavailable favorites with their exact removal identities', async () => {
    const content = {
      id: 'audio',
      title: 'Ambient mix',
      slug: 'ambient-mix',
      thumbnailUrl: 'https://example.test/mix.png',
      type: 'mix',
      url: 'https://example.test/mix.mp3',
    }

    const base = { userId: 'listener', createdAt: '2026-10-03T10:00:00Z' }

    const document = await Effect.runPromise(
      parseDashboardDocument('/api/favorites', {
        success: true,
        total: 3,
        favorites: [
          {
            ...base,
            id: 'favorite-audio',
            membershipRevision: 7,
            audioId: 'audio',
            showId: null,
            audio: content,
            show: null,
          },
          {
            ...base,
            id: 'favorite-show',
            membershipRevision: 12,
            audioId: null,
            showId: 'show',
            audio: null,
            show: {
              id: 'show',
              title: 'Radio show',
              slug: 'radio-show',
              thumbnailUrl: 'https://example.test/show.jpg',
            },
          },
          {
            ...base,
            id: 'favorite-unavailable',
            membershipRevision: 0,
            audioId: 'missing',
            showId: null,
            audio: null,
            show: null,
          },
        ],
      }),
    )

    expect(document.rows).toMatchObject([
      {
        thumbnailUrl: content.thumbnailUrl,
        href: '/mixes/ambient-mix',
        actionId: 'audio',
        membershipRevision: 7,
      },
      {
        thumbnailUrl: 'https://example.test/show.jpg',
        href: '/shows/radio-show',
        actionId: 'show/show',
        membershipRevision: 12,
      },
      {
        thumbnailUrl: null,
        title: 'Unavailable content',
        href: null,
        actionId: 'missing',
        membershipRevision: 0,
      },
    ])
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardCollectionNoDeps, {
            principal,
            section: 'favorites',
            url: '/dashboard/favorites',
            initialDocument: document,
          })

          expect(s.current.query(Locator.attr('src', content.thumbnailUrl))).toBeDefined()
          expect(s.current.query(Locator.text('Unavailable content'))).toBeDefined()
        }),
      ),
    )
  })

  it('retains reminder artwork, missing artwork and command revisions', async () => {
    const document = await Effect.runPromise(
      parseDashboardDocument('/api/music-reminders', {
        success: true,
        total: 2,
        reminders: ['https://example.test/cover.jpg', null].map((albumCoverUrl, index) => ({
          ...reminder,
          id: `reminder-${index}`,
          commandRevision: 3 + index,
          albumCoverUrl,
          dispatchState: 'open',
          status: 'pending',
          isSent: false,
        })),
      }),
    )

    expect(document.rows).toMatchObject([
      {
        thumbnailUrl: 'https://example.test/cover.jpg',
        actionId: 'reminder-0',
        commandRevision: 3,
      },
      { thumbnailUrl: null, actionId: 'reminder-1', commandRevision: 4 },
    ])
  })

  it.each([
    { dispatchState: 'open', status: 'pending', isSent: false, removable: true, detail: 'Artist' },
    {
      dispatchState: 'open',
      status: 'processing',
      isSent: false,
      removable: true,
      detail: 'Artist',
    },
    { dispatchState: 'open', status: 'failed', isSent: false, removable: true, detail: 'Artist' },
    {
      dispatchState: 'cancelled',
      status: 'pending',
      isSent: false,
      removable: false,
      detail: 'Artist · Cancelled',
    },
    {
      dispatchState: 'fenced',
      status: 'processing',
      isSent: false,
      removable: false,
      detail: 'Artist · Delivery may have started',
    },
    {
      dispatchState: 'accepted',
      status: 'sent',
      isSent: true,
      removable: false,
      detail: 'Artist · Sent',
    },
    {
      dispatchState: 'open',
      status: 'sent',
      isSent: false,
      removable: false,
      detail: 'Artist · Sent',
    },
    {
      dispatchState: 'open',
      status: 'pending',
      isSent: true,
      removable: false,
      detail: 'Artist · Sent',
    },
  ])('preserves $dispatchState/$status reminder facts and removal eligibility', async (facts) => {
    const document = await Effect.runPromise(
      parseDashboardDocument('/api/music-reminders', {
        success: true,
        total: 1,
        reminders: [{ ...reminder, ...facts }],
      }),
    )

    expect(document.rows).toMatchObject([
      {
        id: 'reminder',
        commandRevision: 8,
        actionId: facts.removable ? 'reminder' : null,
        detail: facts.detail,
      },
    ])
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const props = {
            principal,
            section: 'reminders',
            url: '/dashboard/reminders',
            initialDocument: document,
          }

          const view = yield* Scene.make(DashboardCollectionNoDeps, props)
          expect(view.current.query(Locator.text('Remove')) !== undefined).toBe(facts.removable)
          const s = yield* Story.make(DashboardCollectionNoDeps, props)
          s.send(CollectionMessage.ClickedRemove({ id: 'reminder' }))

          if (facts.removable) {
            const intent = {
              principalId: 'listener',
              section: 'reminders',
              rowId: 'reminder',
              path: '/api/music-reminders/reminder',
              expectedRevision: 8,
              requestId: null,
            }

            s.expectExact(RemoveSavedItem.make({ intent })).resolve(
              RemoveSavedItem,
              CollectionMessage.FailedRemove({ intent, status: 409, message: 'Changed' }),
            )
          } else s.expectNone()
          expect(s.model.busy).toBe(false)
        }),
      ),
    )
  })
})

describe('legacy endpoint and pagination projection parity', () => {
  it('uses existing profile/content/telemetry endpoints and validates catalogue tabs', () => {
    expect(endpointFor('profile')).toBe('/api/user/profile')
    expect(endpointFor('content/mixes')).toBe('/api/content/audio/mix/manage?limit=25&offset=0')
    expect(endpointFor('frontend-errors')).toBe('/api/admin/telemetry')
    expect(endpointFor('music', new URLSearchParams({ tab: 'labels' }))).toBe(
      '/api/music/labels/manage',
    )
    expect(endpointFor('music', new URLSearchParams({ tab: '../users' }))).toBe(
      '/api/music/artists',
    )
    expect(endpointFor('music-entity/track/some-id')).toBe('/api/music/tracks/some-id')
  })

  it('encodes user searches and retains requested offset when the backend omits it', async () => {
    const path = endpointFor(
      'users',
      new URLSearchParams({ search: ' dj+test@example.com ', offset: '25' }),
    )

    expect(path).toBe(
      '/auth/admin/list-users?limit=25&offset=25&searchField=email&searchValue=dj%2Btest%40example.com',
    )

    const document = await Effect.runPromise(
      parseDashboardDocument(path ?? '', { users: [], total: 27, limit: 25 }),
    )

    expect(document.fields).toEqual({ search: 'dj+test@example.com', offset: '25' })

    for (const offset of ['-1', '1.5', 'NaN', 'Infinity'])
      expect(endpointFor('users', new URLSearchParams({ offset }))).toBe(
        '/auth/admin/list-users?limit=25&offset=0',
      )
  })

  it('waits for a nonblank search and preserves content offsets', () => {
    expect(endpointFor('search')).toBeNull()
    expect(endpointFor('search', new URLSearchParams({ q: '   ' }))).toBeNull()
    expect(endpointFor('search', new URLSearchParams({ q: ' deep house ' }))).toBe(
      '/api/search?q=deep+house',
    )
    expect(endpointFor('all/mixes', new URLSearchParams({ offset: '25' }))).toBe(
      '/api/content/audio/mix/manage?limit=25&offset=25',
    )
    expect(endpointFor('content/tweets', new URLSearchParams({ offset: '-5' }))).toBe(
      '/api/content/posts/manage?limit=25&offset=0&type=micro',
    )
  })
})
