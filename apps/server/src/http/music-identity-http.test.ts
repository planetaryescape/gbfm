import { MusicServiceUnavailableHttpError, MusicServiceUnavailableResponse } from '@gbfm/api/music'
import { Effect, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { describe, expect, test } from 'vitest'

import {
  MusicProviderInvalidInput,
  MusicProviderNotFound,
  MusicProviderRequestFailed,
} from '@/errors'
import {
  MusicIdentityAuthorizationFailed,
  MusicIdentityProviderUnavailable,
} from '@/services/canonical-music-identity/errors'

import {
  mapMusicIdentityErrors,
  mapSpotifyTrackImportErrors,
  PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from './music-identity-http'

describe('music identity HTTP errors', () => {
  test('maps invalid live authority to 403 and verification outage to 503', async () => {
    const denied = await Effect.runPromise(
      Effect.flip(
        mapMusicIdentityErrors(
          Effect.fail(new MusicIdentityAuthorizationFailed({ reason: 'denied' })),
        ),
      ),
    )

    const unavailable = await Effect.runPromise(
      Effect.flip(
        mapMusicIdentityErrors(
          Effect.fail(new MusicIdentityAuthorizationFailed({ reason: 'unavailable' })),
        ),
      ),
    )

    expect(denied).toBeInstanceOf(HttpApiError.Forbidden)
    expect(unavailable).toBeInstanceOf(MusicServiceUnavailableResponse)
  })

  test('maps provider outages to a retry-bearing 503 response', async () => {
    const response = await Effect.runPromise(
      Effect.flip(
        mapMusicIdentityErrors(
          Effect.fail(
            new MusicIdentityProviderUnavailable({
              provider: 'spotify',
              statusCode: 503,
              message: 'Provider unavailable',
            }),
          ),
        ),
      ),
    )

    expect(response).toBeInstanceOf(MusicServiceUnavailableResponse)
    expect(response._tag).toBe('ServiceUnavailable')
    expect(response).toMatchObject({
      retryAfterSeconds: PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS,
    })
    expect(Schema.encodeUnknownSync(MusicServiceUnavailableHttpError)(response).headers).toEqual({
      'retry-after': PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS,
    })
  })

  test('maps Spotify lazy track provider outages to 503 and invalid input to 400', async () => {
    const outage = await Effect.runPromise(
      Effect.flip(
        mapSpotifyTrackImportErrors(
          Effect.fail(
            new MusicProviderRequestFailed({
              message: 'token=provider-secret',
              operation: 'getTrackForImport',
              statusCode: 503,
            }),
          ),
        ),
      ),
    )

    const invalid = await Effect.runPromise(
      Effect.flip(
        mapSpotifyTrackImportErrors(
          Effect.fail(
            new MusicProviderInvalidInput({
              message: 'Invalid track ID provided',
              operation: 'getTrackForImport',
            }),
          ),
        ),
      ),
    )

    const notFound = await Effect.runPromise(
      Effect.flip(
        mapSpotifyTrackImportErrors(
          Effect.fail(
            new MusicProviderNotFound({
              operation: 'getTrackForImport',
              entityType: 'track',
              externalId: 'missing-track',
            }),
          ),
        ),
      ),
    )

    expect(outage).toBeInstanceOf(MusicServiceUnavailableResponse)
    expect(outage._tag).toBe('ServiceUnavailable')
    expect(Schema.encodeUnknownSync(MusicServiceUnavailableHttpError)(outage).headers).toEqual({
      'retry-after': PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS,
    })
    expect(invalid).toBeInstanceOf(HttpApiError.BadRequest)
    expect(notFound).toBeInstanceOf(HttpApiError.BadRequest)
  })
})
