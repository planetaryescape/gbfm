import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import type { QueueTrackType } from '@gbfm/player'
import { Effect } from 'effect'
import { expect, it } from 'vitest'

import { PlaybackControls } from './controls'
import { initialModel } from './domain'
import { PlayerProvider } from './provider'

const emptyPlayer = { ...initialModel, principalId: null, principalKnown: true, returnTo: '/' }

it('keeps transport icons at semantic foreground without changing primary or disabled controls', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const scene = yield* HtmlScene.make(PlaybackControls, {})
        scene.given(null, {}, [[PlayerProvider, emptyPlayer]])

        for (const name of ['Previous track', 'Next track']) {
          const button = scene.get(HtmlLocator.role('button', { name }))
          expect(button.attrs?.class?.split(' ')).toContain('text-foreground')
          expect(button.attrs?.class?.split(' ')).toContain('btn-quiet')
          expect(button.attrs?.disabled).toBeDefined()
        }

        const play = scene.get(HtmlLocator.role('button', { name: 'Play' }))
        expect(play.attrs?.class?.split(' ')).toContain('btn-primary')
        expect(play.attrs?.class?.split(' ')).not.toContain('text-foreground')
        expect(play.attrs?.disabled).toBeDefined()
      }),
    ),
  ))

it('enables transport for a restored queue and keeps compact controls play-only', () =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const track: QueueTrackType = {
          id: 'fixture',
          slug: 'fixture',
          title: 'Long restored transmission title',
          type: 'mix',
          url: '/fixture.wav',
          thumbnailUrl: null,
        }

        const player = {
          ...emptyPlayer,
          snapshot: {
            ...initialModel.snapshot,
            queue: { tracks: [track], current: track, currentIndex: 0 },
          },
        }

        const scene = yield* HtmlScene.make(PlaybackControls, {})
        scene.given(null, {}, [[PlayerProvider, player]])

        for (const name of ['Previous track', 'Next track', 'Play']) {
          expect(scene.get(HtmlLocator.role('button', { name })).attrs?.disabled).toBeUndefined()
        }

        const compact = yield* HtmlScene.make(PlaybackControls, { compact: true })
        compact.given(null, {}, [[PlayerProvider, player]])
        expect(compact.all(HtmlLocator.role('button', { name: 'Next track' }))).toHaveLength(0)
        expect(compact.all(HtmlLocator.role('button', { name: 'Previous track' }))).toHaveLength(0)
        expect(
          compact.get(HtmlLocator.role('button', { name: 'Play' })).attrs?.disabled,
        ).toBeUndefined()
      }),
    ),
  ))
