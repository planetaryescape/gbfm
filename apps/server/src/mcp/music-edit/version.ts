import { Effect, Schema } from 'effect'

import { McpToolError } from '../contracts'
import { MusicEditId, MusicRevision } from './commands'

export const MusicObservation = Schema.Struct({
  entityType: Schema.Literals(['artist', 'album', 'track', 'label']),
  entityId: MusicEditId,
  revision: MusicRevision,
})

export const MusicVersion = Schema.String.check(Schema.isPattern(/^music:sha256:[a-f0-9]{64}$/))

// M2's opaque expectedVersion is a resource-bound projection of the same integer
// revision, not a second revision or ledger. Compare this token to a fresh full
// observation, then CAS the observed integer in the common atomic batch.
export const musicVersion = Effect.fn('MusicEdit.version')(function* (
  observation: typeof MusicObservation.Type,
) {
  const digest = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify([
            'music-revision-v1',
            observation.entityType,
            observation.entityId,
            observation.revision,
          ]),
        ),
      ),
    catch: () =>
      new McpToolError({ code: 'unavailable', message: 'Music version is unavailable.' }),
  })

  return `music:sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
})
