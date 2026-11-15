import {
  hasActiveSpotifyDeviceEffect,
  isSpotifyForbidden,
  playSpotifyEntityEffect,
  queueSpotifyEntityEffect,
  saveSpotifyEntityEffect,
  spotifyErrorMessage,
  type SpotifyEntityRef,
  type SpotifyRequestError,
} from '@gbfm/spotify'
import { Effect } from 'effect'

export type SpotifyEntityAction = 'play' | 'queue' | 'save'

const saveOperation = (entity: SpotifyEntityRef, notice: (message: string) => void) =>
  saveSpotifyEntityEffect(entity).pipe(
    Effect.map((saved) =>
      notice(saved ? 'Saved to your library' : 'Playlists cannot be saved from here'),
    ),
    Effect.catch((error: SpotifyRequestError) =>
      Effect.sync(() =>
        notice(
          isSpotifyForbidden(error)
            ? 'Reconnect Spotify to allow saving'
            : spotifyErrorMessage(error),
        ),
      ),
    ),
  )

export const spotifyEntityOperation = (
  entity: SpotifyEntityRef,
  action: SpotifyEntityAction,
  notice: (message: string) => void,
  open: () => void,
) =>
  action === 'save'
    ? saveOperation(entity, notice)
    : hasActiveSpotifyDeviceEffect().pipe(
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
