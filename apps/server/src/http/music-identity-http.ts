import { MusicServiceUnavailableResponse } from '@gbfm/api/music'
import { Effect, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'

import type { MusicIdentityError } from '@/services/canonical-music-identity'
import {
  MusicIdentityAuthorizationFailed,
  type MusicIdentityBusy,
} from '@/services/canonical-music-identity/errors'
import type { SpotifyServiceError } from '@/services/spotify.service'

export const PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS = 30

const SPOTIFY_PROVIDER_OUTAGE_TAGS = [
  'MusicProviderMisconfigured',
  'MusicProviderRequestFailed',
  'MusicProviderResponseInvalid',
] as const

export const mapSpotifyTrackImportErrors = <A, E, R>(
  effect: Effect.Effect<A, E | SpotifyServiceError, R>,
) =>
  effect.pipe(
    Effect.catchTag(
      ['MusicProviderInvalidInput', 'MusicProviderNotFound'],
      () => new HttpApiError.BadRequest(),
    ),
    Effect.catchTag(
      SPOTIFY_PROVIDER_OUTAGE_TAGS,
      () =>
        new MusicServiceUnavailableResponse({
          retryAfterSeconds: PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS,
        }),
    ),
  )

export const mapMusicIdentityErrors = <A, E, R>(
  effect: Effect.Effect<A, E | MusicIdentityError, R>,
) =>
  effect.pipe(
    Effect.catchTag('MusicIdentityAuthorizationFailed', (error) =>
      Effect.fail<HttpApiError.Forbidden | MusicServiceUnavailableResponse>(
        Schema.is(MusicIdentityAuthorizationFailed)(error) && error.reason === 'denied'
          ? new HttpApiError.Forbidden()
          : new MusicServiceUnavailableResponse({
              retryAfterSeconds: PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS,
            }),
      ),
    ),
    Effect.catchTag('MusicSourceInvalid', () => new HttpApiError.BadRequest()),
    Effect.catchTag('MusicIdentityInvalidSnapshot', () => new HttpApiError.BadRequest()),
    Effect.catchTag('MusicIdentityProviderRejected', () => new HttpApiError.BadRequest()),
    Effect.catchTag('MusicIdentityAliasCollision', () => new HttpApiError.Conflict()),
    Effect.catchTag('MusicIdentityConflict', () => new HttpApiError.Conflict()),
    Effect.catchTag(
      'MusicIdentityBusy',
      (error: MusicIdentityBusy) =>
        new MusicServiceUnavailableResponse({
          retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1000)),
        }),
    ),
    Effect.catchTag(
      'MusicIdentityProviderUnavailable',
      () =>
        new MusicServiceUnavailableResponse({
          retryAfterSeconds: PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS,
        }),
    ),
    Effect.catchTag('MusicIdentityEntityNotFound', () => new HttpApiError.NotFound()),
    Effect.catchTag('MusicIdentitySourceLinkNotFound', () => new HttpApiError.NotFound()),
    Effect.catchTag('MusicIdentityArtworkDeliveryFailed', (cause) => Effect.die(cause)),
    Effect.catchTag('MusicIdentityStorageError', (cause) => Effect.die(cause)),
  )
