import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Story } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import type { QueueTrackType } from '@gbfm/player'
import { Effect } from 'effect'

import { MembershipEntry } from '../../domain/membership'
import { MembershipMessage, MembershipProvider } from '../public-actions/provider'
import { initialModel } from './domain'
import {
  PlayerFavorite,
  PlayerFavoriteMessage,
  WaitBeforeFavoriteNoticeDismissal,
} from './favorite-control'
import { PlayerProvider } from './provider'

const track: QueueTrackType = {
  id: 'favorite-fixture',
  slug: 'favorite-fixture',
  title: 'Favorite fixture',
  type: 'mix',
  url: '/api/e2e-audio.wav',
  thumbnailUrl: null,
}

const target = { kind: 'audio', id: track.id } satisfies MembershipEntry['target']

const contextKey = `0:true:fixture-listener:${track.id}`

const scene = Effect.fnUntraced(function* (entry: MembershipEntry) {
  const player = {
    ...initialModel,
    snapshot: {
      ...initialModel.snapshot,
      queue: { tracks: [track], currentIndex: 0, current: track },
    },
    principalId: 'fixture-listener',
    principalKnown: true,
    returnTo: '/mixes',
  }

  const membership = {
    principalId: 'fixture-listener',
    principalKnown: true,
    generation: 0,
    revision: entry.revision,
    entries: { [`audio:${track.id}`]: entry },
  }

  const story = yield* Story.make(PlayerFavorite, {})
  story
    .given({ contextKey, noticeKey: null, dismissedNoticeKey: null }, {}, [
      [PlayerProvider, player],
      [MembershipProvider, membership],
    ])
    .send(PlayerFavoriteMessage.ChangedContext())
  const key = story.model.noticeKey

  if (!key) throw new Error('Expected a correlated favorite notice')
  story
    .expectExact(WaitBeforeFavoriteNoticeDismissal.make({ key }))
    .keepPending(WaitBeforeFavoriteNoticeDismissal.make({ key }))
  const s = yield* HtmlScene.make(PlayerFavorite, {})
  s.given(story.model, {}, [
    [PlayerProvider, player],
    [MembershipProvider, membership],
  ])

  return { s, key, story }
})

it.effect(
  'renders the existing save-failure copy without changing favorite state and dismisses it safely',
  () =>
    Effect.gen(function* () {
      const { s, key, story } = yield* scene(
        MembershipEntry.make({
          target,
          status: 'inactive',
          busy: false,
          revision: 1,
          request: 2,
          mutationId: null,
          notice: 'Could not save. Try again.',
        }),
      )

      s.expect(HtmlLocator.role('status')).toHaveText('Favorite could not be saved. Try again.')
      const button = s.get(HtmlLocator.role('button', { name: 'Add to favorites' }))
      assert.equal(button.attrs?.['aria-pressed'], 'false')
      assert.equal(button.attrs?.disabled, undefined)
      s.click(HtmlLocator.role('button', { name: 'Dismiss favorite notice' }))
      assert.equal(s.all(HtmlLocator.role('status')).length, 0)
      story.resolve(
        WaitBeforeFavoriteNoticeDismissal,
        PlayerFavoriteMessage.DismissedNotice({ key }),
      )
      assert.equal(story.model.dismissedNoticeKey, key)
      assert.equal(s.all(HtmlLocator.role('status')).length, 0)
    }),
)

it.effect('shows the existing unavailable-status notice with a working retry request', () =>
  Effect.gen(function* () {
    const { s, key, story } = yield* scene(
      MembershipEntry.make({
        target,
        status: 'unavailable',
        busy: false,
        revision: null,
        request: 1,
        mutationId: null,
        notice: null,
      }),
    )

    s.expect(HtmlLocator.role('status')).toHaveText('Favorite status could not be loaded.')
    s.click(HtmlLocator.role('button', { name: 'Retry loading favorite' })).sent(
      MembershipProvider,
      MembershipMessage.RequestedRetryMembership({ target }),
    )
    assert.equal(story.model.contextKey, contextKey)
    story.resolve(WaitBeforeFavoriteNoticeDismissal, PlayerFavoriteMessage.DismissedNotice({ key }))
  }),
)
