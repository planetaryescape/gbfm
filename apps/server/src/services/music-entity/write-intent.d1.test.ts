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

import { deleteArtistEffect } from './artist.service'
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
      disclosure: 'existing',
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

  const remove = (intent: MusicWriteIntent, beforeBatch: () => Promise<void> = async () => {}) =>
    deleteArtistEffect('a', {
      intent,
      references: [],
      context: {
        ...context,
        checkpoint: context.checkpoint.pipe(
          Effect.map((authority) => ({
            ...authority,
            // Equivalent live authority, deliberately exposing opaque OR precedence.
            liveGuard: sql`(${authority.liveGuard}) OR 0`,
          })),
        ),
        execute: (input) =>
          context.execute({
            ...input,
            prepare: async () => {
              const prepared = await input.prepare()
              await beforeBatch()

              return prepared
            },
          }),
      },
    }).pipe(Effect.provideService(Database, f.db), Effect.result)

  return { ...f, write, remove }
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

test('delete loses a late CAS with compound authority without touching junctions, fanout or receipts', async () => {
  await using f = await fixture()
  await f.db.run(sql`INSERT INTO music_albums(id,title,slug,artistNames,createdAt,updatedAt)
    VALUES ('album','Album','album','["Artist"]',1,1)`)
  await f.db.run(sql`INSERT INTO music_album_artists(albumId,artistId) VALUES ('album','a')`)

  const result = await Effect.runPromise(
    f.remove({ requestId: crypto.randomUUID(), expectedRevision: 0 }, async () => {
      await f.db.run(sql`UPDATE music_artists SET revision=1,bio='concurrent' WHERE id='a'`)
    }),
  )

  expect(result).toHaveProperty('failure.code', 'conflict')
  expect(
    await f.db.get(sql`SELECT bio,revision,last_operation_id FROM music_artists WHERE id='a'`),
  ).toEqual({ bio: 'concurrent', revision: 1, last_operation_id: null })
  expect(
    await f.db.get(
      sql`SELECT artistNames,revision,last_operation_id FROM music_albums WHERE id='album'`,
    ),
  ).toEqual({ artistNames: '["Artist"]', revision: 0, last_operation_id: null })
  expect(
    await f.db.all(sql`SELECT artistId FROM music_album_artists WHERE albumId='album'`),
  ).toEqual([{ artistId: 'a' }])
  expect(await f.db.get(sql`SELECT count(*) AS total FROM mcp_operations`)).toEqual({ total: 0 })

  // Final absence after a concurrent deletion is not proof that this attempt won.
  expect(
    await Effect.runPromise(
      f.remove({ requestId: crypto.randomUUID(), expectedRevision: 1 }, async () => {
        await f.db.run(sql`DELETE FROM music_artists WHERE id='a'`)
      }),
    ),
  ).toHaveProperty('failure.code', 'conflict')
  expect(
    await f.db.get(
      sql`SELECT artistNames,revision,last_operation_id FROM music_albums WHERE id='album'`,
    ),
  ).toEqual({ artistNames: '["Artist"]', revision: 0, last_operation_id: null })
  expect(await f.db.get(sql`SELECT count(*) AS total FROM mcp_operations`)).toEqual({ total: 0 })
})

test('delete rolls back acquired markers and earlier fanout on capacity and physical DELETE failures', async () => {
  await using f = await fixture()
  await f.db
    .run(sql`INSERT INTO music_albums(id,title,slug,artistNames,revision,createdAt,updatedAt)
    VALUES ('album','Album','album','["Artist"]',${Number.MAX_SAFE_INTEGER},1,1)`)
  await f.db.run(sql`INSERT INTO music_album_artists(albumId,artistId) VALUES ('album','a')`)
  expect(
    await Effect.runPromise(f.remove({ requestId: crypto.randomUUID(), expectedRevision: 0 })),
  ).toHaveProperty('failure.code', 'conflict')
  expect(
    await f.db.get(sql`SELECT revision,last_operation_id FROM music_artists WHERE id='a'`),
  ).toEqual({ revision: 0, last_operation_id: null })
  expect(
    await f.db.get(sql`SELECT artistNames,revision FROM music_albums WHERE id='album'`),
  ).toEqual({ artistNames: '["Artist"]', revision: Number.MAX_SAFE_INTEGER })

  await f.db.run(sql`UPDATE music_albums SET revision=0 WHERE id='album'`)
  await f.db.run(sql`CREATE TRIGGER prevent_artist_delete BEFORE DELETE ON music_artists
    BEGIN SELECT RAISE(ABORT,'disposable delete failure'); END`)
  expect(
    await Effect.runPromise(f.remove({ requestId: crypto.randomUUID(), expectedRevision: 0 })),
  ).toHaveProperty('failure.code', 'unavailable')
  expect(
    await f.db.get(sql`SELECT revision,last_operation_id FROM music_artists WHERE id='a'`),
  ).toEqual({ revision: 0, last_operation_id: null })
  expect(
    await f.db.get(
      sql`SELECT artistNames,revision,last_operation_id FROM music_albums WHERE id='album'`,
    ),
  ).toEqual({ artistNames: '["Artist"]', revision: 0, last_operation_id: null })
  expect(
    await f.db.all(sql`SELECT artistId FROM music_album_artists WHERE albumId='album'`),
  ).toEqual([{ artistId: 'a' }])
  expect(await f.db.get(sql`SELECT count(*) AS total FROM mcp_operations`)).toEqual({ total: 0 })

  await f.db.run(sql`DROP TRIGGER prevent_artist_delete`)
  await f.db.run(sql`INSERT INTO music_recording_credits
    (id,album_id,artist_id,credited_name,credited_name_key,role,instrument_key,participant_key,
      display_order,source_label,evidence_note,asserted_at,created_at)
    VALUES ('fact','album','a','Artist','artist','producer','','artist:a',0,'Manual','Keep fact',1,1)`)
  expect(
    await Effect.runPromise(f.remove({ requestId: crypto.randomUUID(), expectedRevision: 0 })),
  ).toHaveProperty('failure.code', 'conflict')
  expect(
    await f.db.get(
      sql`SELECT artist_id,evidence_note FROM music_recording_credits WHERE id='fact'`,
    ),
  ).toEqual({ artist_id: 'a', evidence_note: 'Keep fact' })
  expect(
    await f.db.get(sql`SELECT revision,last_operation_id FROM music_artists WHERE id='a'`),
  ).toEqual({ revision: 0, last_operation_id: null })
  expect(await f.db.get(sql`SELECT count(*) AS total FROM mcp_operations`)).toEqual({ total: 0 })
})

test('duplicate deletes replay one durable result but revoked sessions cannot replay it', async () => {
  await using f = await fixture()
  const intent = { requestId: crypto.randomUUID(), expectedRevision: 0 }

  const results = await Promise.all([
    Effect.runPromise(f.remove(intent)),
    Effect.runPromise(f.remove(intent)),
  ])

  expect(results.map(Result.isSuccess)).toEqual([true, true])
  expect(await f.db.get(sql`SELECT id FROM music_artists WHERE id='a'`)).toBeUndefined()
  expect(await f.db.get(sql`SELECT count(*) AS total FROM mcp_operations`)).toEqual({ total: 1 })
  expect(
    await Effect.runPromise(
      f.remove(intent, async () => {
        throw new Error('Replay prepared')
      }),
    ),
  ).toHaveProperty('success')
  expect(
    await Effect.runPromise(f.remove({ ...intent, requestId: crypto.randomUUID() })),
  ).toHaveProperty('failure.code', 'not_found')
  await f.db.delete(session).where(eq(session.id, 'owner-session'))
  expect(await Effect.runPromise(f.remove(intent))).toHaveProperty('failure.code', 'access_denied')
})

test('session revocation during delete preparation prevents root and coupled mutations', async () => {
  await using f = await fixture()

  const result = await Effect.runPromise(
    f.remove({ requestId: crypto.randomUUID(), expectedRevision: 0 }, async () => {
      await f.db.delete(session).where(eq(session.id, 'owner-session'))
    }),
  )

  expect(result).toHaveProperty('failure.code', 'conflict')
  expect(
    await f.db.get(sql`SELECT revision,last_operation_id FROM music_artists WHERE id='a'`),
  ).toEqual({ revision: 0, last_operation_id: null })
  expect(await f.db.get(sql`SELECT count(*) AS total FROM mcp_operations`)).toEqual({ total: 0 })
})
