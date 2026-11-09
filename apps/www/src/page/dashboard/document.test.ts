import type { GetFavoritesResponse } from '@gbfm/api/favorites'
import type { GetMusicRemindersResponse } from '@gbfm/api/music-reminders'
import { Effect, Option } from 'effect'
import { Scene } from 'foldkit/test'
import { describe, expect, it } from 'vitest'

import { collection } from './collection'
import { parseDashboardDocument } from './document'
import { initialModel } from './init'
import { Message } from './message'
import { update } from './update'

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
          membershipRevision: 12,
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
          membershipRevision: 0,
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
        membershipRevision: 7,
      },
      {
        thumbnailUrl: 'https://example.test/show-cover.jpg',
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
  })

  it('retains reminder cover art and missing-cover values without changing removal IDs', async () => {
    const response: typeof GetMusicRemindersResponse.Type = {
      success: true,
      total: 2,
      reminders: ['https://example.test/album-cover.jpg', null].map((albumCoverUrl, index) => ({
        id: `reminder-${index}`,
        commandRevision: 3 + index,
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
      {
        thumbnailUrl: 'https://example.test/album-cover.jpg',
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
  ] as const)(
    'retains $dispatchState/$status reminder facts but renders removal only when eligible',
    async ({ dispatchState, status, isSent, removable, detail }) => {
      const document = await Effect.runPromise(
        parseDashboardDocument('/api/music-reminders', {
          success: true,
          total: 1,
          reminders: [
            {
              id: 'reminder',
              commandRevision: 8,
              dispatchState,
              status,
              isSent,
              userId: 'listener',
              musicTitle: 'Fixture',
              artistName: 'Artist',
              musicUrl: 'https://example.test/music',
              albumCoverUrl: null,
              reminderDate: '2099-11-12T10:00:00Z',
              notes: null,
              createdAt: '2026-11-09T10:00:00Z',
              updatedAt: '2026-11-09T10:00:00Z',
            },
          ],
        }),
      )

      expect(document.rows).toMatchObject([
        { id: 'reminder', commandRevision: 8, actionId: removable ? 'reminder' : null, detail },
      ])

      const model = update(
        initialModel('reminders', { id: 'listener', role: 'user' }),
        Message.Loaded({ document }),
      ).model

      Scene.scene(
        { update, view: collection },
        Scene.given(model),
        Scene.tap(({ html }) => {
          expect(Option.isSome(Scene.getByRole('button', { name: 'Remove Fixture' })(html))).toBe(
            removable,
          )
        }),
      )

      expect(update(model, Message.DeleteRequested({ id: 'reminder' })).commands?.length ?? 0).toBe(
        removable ? 1 : 0,
      )
    },
  )
})
