import {
  hasActiveSpotifyDeviceEffect,
  playSpotifyEntityEffect,
  queueSpotifyEntityEffect,
  spotifyErrorMessage,
  type SpotifyEntityRef,
  type SpotifyRequestError,
} from '@gbfm/spotify'
import { Effect } from 'effect'

export const spotifyEntityOperation = (
  entity: SpotifyEntityRef,
  action: 'play' | 'queue',
  notice: (message: string) => void,
  open: () => void,
) =>
  hasActiveSpotifyDeviceEffect().pipe(
    Effect.flatMap((hasDevice) => {
      if (!hasDevice)
        return Effect.sync(() => {
          notice('No active Spotify device, opening in Spotify instead')
          open()
        })

      if (action === 'play')
        return playSpotifyEntityEffect(entity).pipe(
          Effect.map(() => notice(`Playing ${entity.kind}`)),
        )

      return queueSpotifyEntityEffect(entity).pipe(
        Effect.map((count) =>
          notice(count === 1 ? 'Added to queue' : `Added ${count} tracks to queue`),
        ),
      )
    }),
    Effect.catch((error: SpotifyRequestError) =>
      Effect.sync(() => {
        notice(spotifyErrorMessage(error))
        open()
      }),
    ),
  )
