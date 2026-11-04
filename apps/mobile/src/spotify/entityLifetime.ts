import type { SpotifyEntityRef } from '@gbfm/spotify'
import { Effect } from 'effect'

import type { SpotifyConnectionLifecycle } from './connectionLifecycle'
import { spotifyEntityOperation } from './entityOperation'

type EntityOperationOwner = { readonly sequence: number }

export const spotifyEntityLifetime = () => {
  let mounted = true
  let active: EntityOperationOwner | null = null
  let sequence = 0

  return {
    activate: () => {
      mounted = true
    },
    dispose: () => {
      mounted = false
      active = null
    },
    begin: () => {
      if (!mounted || active) return null
      sequence += 1
      active = { sequence }

      return active
    },
    owns: (owner: EntityOperationOwner) => mounted && active === owner,
    finish: (owner: EntityOperationOwner) => {
      if (!mounted || active !== owner) return false
      active = null

      return true
    },
  }
}

export const runSpotifyEntityAction = async (input: {
  readonly lifetime: ReturnType<typeof spotifyEntityLifetime>
  readonly lifecycle: SpotifyConnectionLifecycle
  readonly generation: number
  readonly entity: SpotifyEntityRef
  readonly action: 'play' | 'queue'
  readonly setPending: (action: 'play' | 'queue' | null) => void
  readonly notice: (message: string) => void
  readonly open: () => void
}) => {
  if (!input.lifecycle.owns(input.generation)) return
  const owner = input.lifetime.begin()

  if (!owner) return
  const session = input.generation
  const owns = () => input.lifetime.owns(owner) && input.lifecycle.owns(session)
  input.setPending(input.action)

  try {
    await input.lifecycle.run(
      session,
      Effect.suspend(() =>
        owns()
          ? spotifyEntityOperation(
              input.entity,
              input.action,
              (message) => {
                if (owns()) input.notice(message)
              },
              () => {
                if (owns()) input.open()
              },
            )
          : Effect.void,
      ),
    )
  } catch {
    if (owns()) input.notice('Spotify is unavailable. Try again.')
  } finally {
    if (input.lifetime.finish(owner) && input.lifecycle.owns(session)) input.setPending(null)
  }
}
