import { Component } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { ReloadSpotifyPage, SpotifyLoadRecovery, SpotifyLoadRecoveryMessage } from './load-recovery'

describe('Spotify reload recovery', () => {
  it('requests a reload only after an interactive click', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(SpotifyLoadRecovery, { interactive: true, busy: false })
          s.expectExact()
          s.send(SpotifyLoadRecoveryMessage.ClickedReload())
          s.expectExact(ReloadSpotifyPage.make())
          s.resolve(ReloadSpotifyPage, Component.noop)
          s.expectExact()
          expect(s.model).toBeNull()
        }),
      ),
    ))

  it.each([
    { interactive: false, busy: false },
    { interactive: true, busy: true },
  ])('does not reload disabled controls: %o', (props) =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(SpotifyLoadRecovery, props)
          s.send(SpotifyLoadRecoveryMessage.ClickedReload())
          s.expectExact()
          expect(s.model).toBeNull()
        }),
      ),
    ),
  )
})
