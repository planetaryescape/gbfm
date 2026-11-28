import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'

import { initialModel, initialSnapshot } from '../player/domain'
import { PlayerMessage, PlayerProvider } from '../player/provider'
import { contentTrack } from './cards'
import { publicMix } from './fixtures'
import { PlaybackControls, PlaylistControls } from './playback-controls'

it.effect(
  'plays a new track, toggles the current track and enqueues through the real provider contract',
  () =>
    Effect.gen(function* () {
      const track = contentTrack(publicMix)

      if (!track) throw new Error('Missing audio fixture')
      const s = yield* HtmlScene.make(PlaybackControls, { track, enqueue: true })
      s.shared(PlayerProvider, {
        ...initialModel,
        snapshot: {
          ...initialSnapshot,
          transport: { ...initialSnapshot.transport, isInitialized: true },
        },
        returnTo: publicMix.href,
        principalId: null,
        principalKnown: true,
      })
        .click(HtmlLocator.role('button', { name: 'Play' }))
        .sent(PlayerProvider, PlayerMessage.RequestedPlayTrack({ track }))
        .click(HtmlLocator.role('button', { name: 'Add to queue' }))
        .sent(PlayerProvider, PlayerMessage.RequestedEnqueue({ track }))
      s.shared(PlayerProvider, {
        ...initialModel,
        returnTo: publicMix.href,
        principalId: null,
        principalKnown: true,
        snapshot: {
          ...initialModel.snapshot,
          queue: { tracks: [track], currentIndex: 0, current: track },
          transport: { ...initialModel.snapshot.transport, isInitialized: true, isPlaying: true },
        },
      })
        .click(HtmlLocator.role('button', { name: 'Pause' }))
        .sent(PlayerProvider, PlayerMessage.RequestedTogglePlayPause())
    }),
)

it.effect('preserves order for both play-all and queue-all provider intents', () =>
  Effect.gen(function* () {
    const track = contentTrack(publicMix)

    if (!track) throw new Error('Missing audio fixture')
    const second = { ...track, id: 'mix-2', slug: 'dawn', title: 'Dawn' }
    const tracks = [track, second]
    const s = yield* HtmlScene.make(PlaylistControls, { tracks })
    s.shared(PlayerProvider, {
      ...initialModel,
      snapshot: {
        ...initialSnapshot,
        transport: { ...initialSnapshot.transport, isInitialized: true },
      },
      returnTo: publicMix.href,
      principalId: null,
      principalKnown: true,
    })
    s.click('Play all')
      .sent(PlayerProvider, PlayerMessage.RequestedPlayAll({ tracks }))
      .click('Queue all')
      .sent(PlayerProvider, PlayerMessage.RequestedEnqueueAll({ tracks }))
    assert.deepStrictEqual(
      tracks.map((value) => value.id),
      ['mix-1', 'mix-2'],
    )
  }),
)

it.effect(
  'keeps featured and listing play actions opening the player even for the current mix',
  () =>
    Effect.gen(function* () {
      const track = contentTrack(publicMix)

      if (!track) throw new Error('Missing audio fixture')

      const s = yield* HtmlScene.make(PlaybackControls, {
        track,
        compact: true,
        label: 'Play mix',
        toggleCurrent: false,
      })

      s.shared(PlayerProvider, {
        ...initialModel,
        returnTo: publicMix.href,
        principalId: null,
        principalKnown: true,
        snapshot: {
          ...initialModel.snapshot,
          queue: { tracks: [track], currentIndex: 0, current: track },
          transport: { ...initialModel.snapshot.transport, isInitialized: true, isPlaying: true },
        },
      })
        .click('Play mix')
        .sent(PlayerProvider, PlayerMessage.RequestedPlayTrack({ track }))
    }),
)
