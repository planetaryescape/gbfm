import type { Component } from '@effect/ui'
import { expectTypeOf, it } from 'vitest'

import type { PublicContentPage } from '../../features/content'
import type { ReadSpotifyStatus } from '../../features/spotify/commands'
import type { SpotifyProvider } from '../../features/spotify/provider'

type PublicContentRequirements = Component.Requirements<typeof PublicContentPage>

type SpotifyOwner = Component.Shared.Of<typeof SpotifyProvider>

it('preserves Spotify provider and query requirements through spotlight presentation', () => {
  expectTypeOf<Extract<PublicContentRequirements, SpotifyOwner>>().toEqualTypeOf<SpotifyOwner>()
  expectTypeOf<
    Extract<PublicContentRequirements, ReadSpotifyStatus>
  >().toEqualTypeOf<ReadSpotifyStatus>()
})
