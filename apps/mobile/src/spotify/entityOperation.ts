import {
  isSpotifyForbidden,
  playSpotifyEntityEffect,
  queueSpotifyEntityEffect,
  saveSpotifyEntityEffect,
  spotifyErrorMessage,
  spotifyPlaybackTargetEffect,
  type SpotifyEntityRef,
  type SpotifyRequestError,
} from '@gbfm/spotify'
import { SpotifyHttpError } from '@spotify-effect/core'
import { Effect } from 'effect'

export type SpotifyEntityAction = 'play' | 'queue' | 'save'

export const SPOTIFY_NOTICES = {
  opening: 'Spotify is not running, opening it to play',
  nothingPlaying: 'Nothing is playing on Spotify. Tap Play to start.',
  premium: 'Spotify Premium is needed to control playback',
} as const

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

const playOperation = (
  entity: SpotifyEntityRef,
  notice: (message: string) => void,
  open: () => void,
) =>
  spotifyPlaybackTargetEffect().pipe(
    Effect.flatMap((target) => {
      if (!target)
        return Effect.sync(() => {
          notice(SPOTIFY_NOTICES.opening)
          open()
        })

      return playSpotifyEntityEffect(entity, target.id).pipe(
        Effect.map(() =>
          notice(
            target.active ? `Playing ${entity.kind}` : `Playing ${entity.kind} on ${target.name}`,
          ),
        ),
      )
    }),
    Effect.catch((error: SpotifyRequestError) =>
      Effect.sync(() => {
        if (error instanceof SpotifyHttpError && error.status === 404) {
          notice(SPOTIFY_NOTICES.opening)
          open()

          return
        }

        notice(isSpotifyForbidden(error) ? SPOTIFY_NOTICES.premium : spotifyErrorMessage(error))
      }),
    ),
  )

const queueOperation = (entity: SpotifyEntityRef, notice: (message: string) => void) =>
  spotifyPlaybackTargetEffect().pipe(
    Effect.flatMap((target) => {
      if (!target?.active) return Effect.sync(() => notice(SPOTIFY_NOTICES.nothingPlaying))

      return queueSpotifyEntityEffect(entity, target.id).pipe(
        Effect.map((count) =>
          notice(count === 1 ? 'Added to queue' : `Added ${count} tracks to queue`),
        ),
      )
    }),
    Effect.catch((error: SpotifyRequestError) =>
      Effect.sync(() =>
        notice(
          error instanceof SpotifyHttpError && error.status === 404
            ? SPOTIFY_NOTICES.nothingPlaying
            : isSpotifyForbidden(error)
              ? SPOTIFY_NOTICES.premium
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
  ({
    save: () => saveOperation(entity, notice),
    play: () => playOperation(entity, notice, open),
    queue: () => queueOperation(entity, notice),
  })[action]()
