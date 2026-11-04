import { logoutSpotifyEffect, type SpotifyBrowser } from '@gbfm/spotify'
import type { Effect } from 'effect'

export type SpotifyRunner = <A, E>(
  work: Effect.Effect<A, E, SpotifyBrowser>,
  options?: { readonly isCurrent: () => boolean },
) => Promise<A>

export const spotifyConnectionLifecycle = (
  run: SpotifyRunner,
  invalidateTokens: () => void = () => {},
) => {
  let generation = 0
  let login: number | null = null
  let tail = Promise.resolve()
  const owns = (owner: number) => owner === generation

  const enqueue = <A>(work: () => Promise<A>): Promise<A> => {
    const result = tail.then(work)
    tail = result.then(
      () => {},
      () => {},
    )

    return result
  }

  return {
    current: () => generation,
    owns,
    beginLogin: () => {
      if (login !== null) return null
      generation += 1
      login = generation

      return generation
    },
    finishLogin: (owner: number) => {
      if (login === owner) login = null
    },
    run: <A, E>(owner: number, work: Effect.Effect<A, E, SpotifyBrowser>) =>
      enqueue(async () => {
        if (!owns(owner)) return undefined

        try {
          const result = await run(work, { isCurrent: () => owns(owner) })

          return owns(owner) ? result : undefined
        } finally {
          if (!owns(owner)) await run(logoutSpotifyEffect())
        }
      }),
    disconnect: () => {
      generation += 1
      login = null
      invalidateTokens()

      return enqueue(() => run(logoutSpotifyEffect()))
    },
  }
}

export type SpotifyConnectionLifecycle = ReturnType<typeof spotifyConnectionLifecycle>
