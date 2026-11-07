import { Effect, Result } from 'effect'
import { expect, test } from 'vitest'

import {
  MusicIdentityBusy,
  MusicIdentityConflict,
  MusicIdentityProviderRejected,
  MusicIdentityProviderUnavailable,
  MusicIdentityStorageError,
} from '@/services/canonical-music-identity/errors'

import { projectImportPersistence } from './outcome'

test('maps typed failures without leaking provider messages or conflict internals', async () => {
  const secret = 'provider-private-payload'

  const cases = [
    {
      error: new MusicIdentityProviderUnavailable({ provider: secret, message: secret }),
      code: 'unavailable',
    },
    {
      error: new MusicIdentityStorageError({ operation: secret, message: secret }),
      code: 'unavailable',
    },
    {
      error: new MusicIdentityProviderRejected({
        provider: secret,
        reason: 'not_found',
        message: secret,
      }),
      code: 'not_found',
    },
    {
      error: new MusicIdentityConflict({
        sourceKey: secret,
        incumbentEntityType: 'track',
        incumbentEntityId: secret,
        candidateEntityType: 'track',
        candidateEntityId: secret,
      }),
      code: 'conflict',
    },
    { error: new MusicIdentityBusy({ retryAfterMs: 61_001 }), code: 'rate_limited' },
  ]

  for (const { error, code } of cases) {
    const result = await Effect.runPromise(
      projectImportPersistence(Result.fail(error)).pipe(Effect.result),
    )

    expect(result).toMatchObject({ failure: { code } })
    expect(JSON.stringify(result)).not.toContain(secret)
  }

  for (const [retryAfterMs, retryAfterSeconds] of [
    [0, 1],
    [1001, 2],
    [61_001, 60],
  ]) {
    expect(
      await Effect.runPromise(
        projectImportPersistence(
          Result.fail(new MusicIdentityBusy({ retryAfterMs: retryAfterMs! })),
        ).pipe(Effect.result),
      ),
    ).toMatchObject({ failure: { retryAfterSeconds } })
  }
})
