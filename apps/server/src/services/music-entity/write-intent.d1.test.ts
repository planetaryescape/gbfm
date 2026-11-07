import { AuthSession } from '@gbfm/api/middleware/auth'
import { eq, sql } from 'drizzle-orm'
import { Effect, Result, Schema } from 'effect'
import { expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { makeSessionCommandAuthority } from '@/mcp/command-authority'
import { createMcpOperationStore } from '@/mcp/operations/store'
import { ConfigService } from '@/services/config.service'
import { createEditorialOAuthFixture } from '@/test/editorial-oauth'

import { musicParentCas, musicParentWinner } from './guarded-statements'
import {
  executeMusicWrite,
  type MusicWriteContext,
  MusicWriteError,
  type MusicWriteIntent,
  MusicWriteStoredOutcome,
  MusicWriteStoreResult,
} from './write-intent'

const fixture = async () => {
  const f = await createEditorialOAuthFixture()
  await f.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  await f.db.run(sql`INSERT INTO music_artists(id,name,slug,bio,createdAt,updatedAt)
    VALUES ('a','Artist','artist','original',1,1)`)

  const authority = await Effect.runPromise(
    makeSessionCommandAuthority.pipe(
      Effect.provideService(AuthSession, {
        user: { id: 'owner', name: 'owner', email: 'owner@example.com' },
        session: { id: 'owner-session', createdAt: new Date() },
      }),
      Effect.provideService(Database, f.db),
      Effect.provideService(ConfigService, f.config),
    ),
  )

  const store = createMcpOperationStore(f.database)

  const context: MusicWriteContext = {
    now: Date.now(),
    checkpoint: authority.checkpoint(['catalogue:write']).pipe(
      Effect.mapError(
        (error) =>
          new MusicWriteError({
            code: error.code === 'access_denied' ? 'access_denied' : 'unavailable',
            message: 'Music write authorization failed.',
          }),
      ),
    ),
    execute: async (input) =>
      Schema.decodeUnknownSync(MusicWriteStoreResult)(
        await store.execute({
          ...input,
          authorize: (outcome) =>
            input.authorize(
              outcome === undefined
                ? undefined
                : Schema.decodeUnknownSync(MusicWriteStoredOutcome)(outcome),
            ),
        }),
      ),
  }

  const write = (
    intent: MusicWriteIntent | undefined,
    bio: string,
    pause: Effect.Effect<void> = Effect.void,
  ) =>
    executeMusicWrite(intent, context, {
      operation: 'fixture_browser_metadata',
      target: { entityType: 'artist', entityId: 'a' },
      normalizedInput: { bio },
      prepare: Effect.gen(function* () {
        yield* pause

        const row = yield* Effect.promise(() =>
          f.db.get(sql`SELECT revision FROM music_artists WHERE id='a'`),
        )

        if (!row)
          return yield* new MusicWriteError({ code: 'not_found', message: 'Artist not found.' })

        return {
          build: (attempt) => {
            const target = { entityType: 'artist', entityId: 'a' } as const

            return {
              statements: [
                attempt.prepare(
                  musicParentCas({
                    target,
                    expectedRevision: intent?.expectedRevision ?? -1,
                    changed: true,
                    attemptId: attempt.attemptId,
                    fence: attempt.fence,
                    liveGuard: attempt.liveGuard,
                    eligibility: sql`1`,
                    assignments: [sql`bio=${bio}`],
                  }),
                ),
              ],
              assertApplied: sql`(${attempt.fence}) AND (${attempt.liveGuard})
                AND (${musicParentWinner(target, attempt.attemptId)})`,
              outcome: { result: { bio }, revision: null, access: target },
            }
          },
        }
      }),
    }).pipe(Effect.provideService(Database, f.db), Effect.result)

  return { ...f, write }
}

test('domain intent requires the observed version, rejects stale writes and replays before later preparation', async () => {
  await using f = await fixture()
  expect(await Effect.runPromise(f.write(undefined, 'missing'))).toMatchObject({
    failure: { code: 'precondition_required' },
  })
  const first = { requestId: crypto.randomUUID(), expectedRevision: 0 }
  const original = await Effect.runPromise(f.write(first, 'first'))
  expect(original).toHaveProperty('success.status', 'applied')

  expect(
    await Effect.runPromise(
      f.write({ requestId: crypto.randomUUID(), expectedRevision: 0 }, 'stale'),
    ),
  ).toHaveProperty('failure.code', 'conflict')
  expect(
    await Effect.runPromise(
      f.write({ requestId: crypto.randomUUID(), expectedRevision: 1 }, 'later'),
    ),
  ).toHaveProperty('success.status', 'applied')

  const replay = await Effect.runPromise(
    f.write(first, 'first', Effect.die('Replay must not prepare current rows')),
  )

  expect(replay).toMatchObject({
    success: { status: 'replayed', outcome: { result: { bio: 'first' } } },
  })
  expect(await f.db.get(sql`SELECT bio,revision FROM music_artists WHERE id='a'`)).toEqual({
    bio: 'later',
    revision: 2,
  })
  expect(await Effect.runPromise(f.write(first, 'different payload'))).toMatchObject({
    failure: { code: 'conflict' },
  })

  await f.db
    .update(session)
    .set({ expiresAt: new Date(0) })
    .where(eq(session.id, 'owner-session'))
  expect(await Effect.runPromise(f.write(first, 'first'))).toMatchObject({
    failure: { code: 'access_denied' },
  })
})

test('real session revocation after preparation starts blocks the physical CAS and saves no receipt', async () => {
  await using f = await fixture()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()

  const pending = Effect.runPromise(
    f.write(
      { requestId: crypto.randomUUID(), expectedRevision: 0 },
      'must not persist',
      Effect.promise(async () => {
        entered.resolve()
        await release.promise
      }),
    ),
  )

  try {
    await entered.promise
    await f.db.delete(session).where(eq(session.id, 'owner-session'))
  } finally {
    release.resolve()
  }

  const result = await pending
  expect(Result.isFailure(result) && result.failure.code).toBe('conflict')
  expect(
    await f.db.get(sql`SELECT bio,revision,last_operation_id FROM music_artists WHERE id='a'`),
  ).toEqual({
    bio: 'original',
    revision: 0,
    last_operation_id: null,
  })
  expect(await f.db.get(sql`SELECT count(*) AS total FROM mcp_operations`)).toEqual({ total: 0 })
})
