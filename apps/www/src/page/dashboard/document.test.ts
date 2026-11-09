import type { GetFavoritesResponse } from '@gbfm/api/favorites'
import type { GetMusicRemindersResponse } from '@gbfm/api/music-reminders'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { parseDashboardDocument } from './document'

describe('dashboard collection artwork', () => {
  it('retains audio and show thumbnails while keeping unavailable favorites readable', async () => {
    const response: typeof GetFavoritesResponse.Type = {
      success: true,
      total: 3,
      favorites: [
        {
          id: 'favorite-audio',
          membershipRevision: 7,
          userId: 'listener',
          audioId: 'audio',
          showId: null,
          createdAt: '2026-10-03T10:00:00Z',
          audio: {
            id: 'audio',
            title: 'Ambient mix',
            slug: 'ambient-mix',
            thumbnailUrl: 'https://cdn.goosebumps.fm/mix-cover.png',
            type: 'mix',
            url: 'https://example.test/mix.mp3',
          },
          show: null,
        },
        {
          id: 'favorite-show',
          membershipRevision: 7,
          userId: 'listener',
          audioId: null,
          showId: 'show',
          createdAt: '2026-10-03T10:00:00Z',
          audio: null,
          show: {
            id: 'show',
            title: 'Radio show',
            slug: 'radio-show',
            thumbnailUrl: 'https://example.test/show-cover.jpg',
          },
        },
        {
          id: 'favorite-unavailable',
          membershipRevision: 7,
          userId: 'listener',
          audioId: 'missing',
          showId: null,
          createdAt: '2026-10-03T10:00:00Z',
          audio: null,
          show: null,
        },
      ],
    }

    const document = await Effect.runPromise(parseDashboardDocument('/api/favorites', response))

    expect(document.rows).toMatchObject([
      {
        thumbnailUrl: 'https://cdn.goosebumps.fm/mix-cover.png',
        href: '/mixes/ambient-mix',
        actionId: 'audio',
      },
      {
        thumbnailUrl: 'https://example.test/show-cover.jpg',
        href: '/shows/radio-show',
        actionId: 'show/show',
      },
      { thumbnailUrl: null, title: 'Unavailable content', href: null, actionId: 'missing' },
    ])
  })

  it('retains reminder cover art and missing-cover values without changing removal IDs', async () => {
    const response: typeof GetMusicRemindersResponse.Type = {
      success: true,
      total: 2,
      reminders: ['https://example.test/album-cover.jpg', null].map((albumCoverUrl, index) => ({
        id: `reminder-${index}`,
        commandRevision: 3,
        dispatchState: 'open' as const,
        userId: 'listener',
        musicTitle: 'Album',
        artistName: 'Artist',
        musicUrl: 'https://example.test/album',
        albumCoverUrl,
        reminderDate: '2026-10-04T10:00:00Z',
        notes: null,
        status: 'pending',
        isSent: false,
        createdAt: '2026-10-03T10:00:00Z',
        updatedAt: '2026-10-03T10:00:00Z',
      })),
    }

    const document = await Effect.runPromise(
      parseDashboardDocument('/api/music-reminders', response),
    )

    expect(document.rows).toMatchObject([
      { thumbnailUrl: 'https://example.test/album-cover.jpg', actionId: 'reminder-0' },
      { thumbnailUrl: null, actionId: 'reminder-1' },
    ])
  })
})
