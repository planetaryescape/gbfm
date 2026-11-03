import type { SpotifyAuthSession, SpotifyProfile } from '@gbfm/spotify'
import { Data } from 'effect'

export type SpotifyConnectionState =
  | { readonly _tag: 'Bootstrapping' }
  | { readonly _tag: 'Disconnected'; readonly error?: string }
  | { readonly _tag: 'Connecting' }
  | {
      readonly _tag: 'Connected'
      readonly session: SpotifyAuthSession
      readonly profile?: SpotifyProfile
      readonly error?: string
    }

export const SpotifyConnectionState = Data.taggedEnum<SpotifyConnectionState>()

export type SetConnectionState = (
  update: (state: SpotifyConnectionState) => SpotifyConnectionState,
) => void
