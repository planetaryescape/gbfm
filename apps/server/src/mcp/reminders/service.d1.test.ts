import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Logger, type Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { McpToolError } from '@/mcp/contracts'
import { McpOperationStoreLayer } from '@/mcp/operations/store'
import { EmailDelivery } from '@/services/email-delivery.service'
import { MusicReminderService, MusicReminderServiceLayer } from '@/services/music-reminder.service'
import {
  processReminderJob,
  queryDueReminders,
  queryNextDueReminder,
  getReminderStats,
  claimReminder,
  sendClaimedReminder,
} from '@/services/reminder-processor'
import { withTestLayer } from '@/test/effect'
import { gatedPostDatabase } from '@/test/gated-post-database'
import { createMigratedD1Database } from '@/test/migrate-d1'
import { reminderClock } from '@/test/reminder-clock'

import {
  ReminderCommandService,
  ReminderCommandServiceLayer,
  type ReminderAuthority,
} from './service'

const create = (requestId = crypto.randomUUID()) => ({
  operation: 'create_music_reminder',
  input: {
    requestId,
    musicTitle: 'Night Mix',
    artistName: 'DJ',
    musicUrl: 'https://private.example.test/mix',
    notes: 'Private notes',
    reminderDate: '1970-01-01T00:00:00Z',
  },
})

const fixture = async () => {
  const resource = await createMigratedD1Database()
  const database = DatabaseLayer(resource.database)
  const db = Effect.runSync(withTestLayer(Database, database))
  await db.insert(user).values([
    { id: 'owner', name: 'Owner', email: 'owner@example.test', role: 'user' },
    { id: 'other', name: 'Other', email: 'other@example.test', role: 'user' },
  ])
  const clock = reminderClock(1_800_000_000_000)
  const logs: Array<unknown> = []
  const logging = Logger.layer([Logger.make(({ message }) => logs.push(message))])
  const base = Layer.mergeAll(database, McpOperationStoreLayer(resource.database), clock.layer)

  const layer = ReminderCommandServiceLayer.pipe(
    Layer.provide(base),
    Layer.provideMerge(clock.layer),
    Layer.provideMerge(logging),
  )

  // Disposable request authority over real persisted account state. Production
  // transport must supply its credential-bound P1 CommandAuthority, not this fixture.
  const authority = (actorId = 'owner'): ReminderAuthority => ({
    checkpoint: () =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db.select({ banned: user.banned }).from(user).where(eq(user.id, actorId)),
        )

        if (!rows[0] || rows[0].banned)
          return yield* new McpToolError({ code: 'access_denied', message: 'Denied' })

        return {
          actorId,
          clientId: 'fixture-browser',
          resource: 'https://api.test/api',
          liveGuard: sql`EXISTS (SELECT 1 FROM user WHERE id=${actorId} AND coalesce(banned,0)=0)`,
        }
      }),
  })

  const run = (raw: Schema.Json, actor = authority()) =>
    Effect.runPromise(
      withTestLayer(
        Effect.flatMap(ReminderCommandService, (service) => service.execute(raw, actor)),
        layer,
      ),
    )

  const fail = (raw: Schema.Json, actor = authority()) =>
    Effect.runPromise(
      withTestLayer(
        Effect.flip(
          Effect.flatMap(ReminderCommandService, (service) => service.execute(raw, actor)),
        ),
        layer,
      ),
    )

  const page = () =>
    Effect.runPromise(
      withTestLayer(
        Effect.flatMap(MusicReminderService, (service) =>
          service.getPageByUserId('owner', { limit: 20, offset: 0 }),
        ),
        MusicReminderServiceLayer.pipe(Layer.provide(database)),
      ),
    )

  return { ...resource, db, run, fail, clock, authority, page, logs }
}

describe('atomic reminder commands on fully migrated D1', () => {
  test('dependency and persisted-row failures emit coarse diagnostics without private data', async () => {
    await using f = await fixture()
    const created = await f.run(create())
    await f.database
      .prepare('UPDATE music_reminder SET reminder_date=9000000000000000 WHERE id=?')
      .bind(created.reminderId)
      .run()

    const cancel = {
      operation: 'cancel_music_reminder',
      input: {
        requestId: crypto.randomUUID(),
        reminderId: created.reminderId,
        expectedRevision: 1,
      },
    }

    expect(await f.fail(cancel)).toMatchObject({ code: 'unavailable' })
    await f.database.prepare('DROP TABLE music_reminder').run()
    expect(await f.fail(cancel)).toMatchObject({ code: 'unavailable' })
    expect(await f.fail(create())).toMatchObject({ code: 'unavailable' })
    expect(f.logs).toHaveLength(3)
    const logged = JSON.stringify(f.logs)

    for (const code of ['invalid_persisted_row', 'database_error', 'operation_unavailable'])
      expect(logged).toContain(code)

    for (const privateValue of [
      'owner',
      created.reminderId,
      cancel.input.requestId,
      'Night Mix',
      'Private notes',
      'private.example.test',
      '9000000000000000',
      'DROP TABLE',
      'SELECT',
    ])
      expect(logged).not.toContain(privateValue)
    expect(await f.database.prepare('SELECT count(*) AS n FROM mcp_operations').first()).toEqual({
      n: 1,
    })
  })

  test('two senders holding the same claim cannot both cross its dispatch fence', async () => {
    await using f = await fixture()
    const created = await f.run(create())
    const sent: Array<string> = []

    const layer = Layer.mergeAll(
      DatabaseLayer(f.database),
      f.clock.layer,
      Layer.succeed(EmailDelivery, {
        deliver: () =>
          Effect.sync(() => {
            sent.push(created.reminderId)

            return {
              deliveryLogId: 'fixture',
              provider: 'cloudflare' as const,
              providerMessageId: 'fixture',
              acceptedAt: new Date(f.clock.now()),
            }
          }),
      }),
    )

    await Effect.runPromise(withTestLayer(claimReminder(created.reminderId), layer))
    const [claimed] = await f.db.select().from(musicReminder)

    if (!claimed) throw new Error('Missing claimed fixture')
    await Promise.all(
      [0, 1].map(() => Effect.runPromise(withTestLayer(sendClaimedReminder(claimed), layer))),
    )
    expect(sent).toHaveLength(1)
    expect((await f.db.select().from(musicReminder))[0]).toMatchObject({
      dispatchState: 'accepted',
      commandRevision: 1,
    })
  })

  for (const phase of ['before', 'after'] as const) {
    for (const operation of ['cancel_music_reminder', 'reschedule_music_reminder'] as const) {
      test(`${operation} ${phase} dispatch fence has a truthful outcome`, async () => {
        await using f = await fixture()
        const created = await f.run(create())

        const gate = gatedPostDatabase(
          f.database,
          phase,
          /^update "music_reminder" set "dispatch_state"/i,
        )

        const sent: Array<string> = []

        const layer = Layer.mergeAll(
          DatabaseLayer(gate.database),
          f.clock.layer,
          Layer.succeed(EmailDelivery, {
            deliver: () =>
              Effect.sync(() => {
                sent.push(created.reminderId)

                return {
                  deliveryLogId: 'fixture',
                  provider: 'cloudflare' as const,
                  providerMessageId: 'fixture',
                  acceptedAt: new Date(f.clock.now()),
                }
              }),
          }),
        )

        const pending = Effect.runPromise(
          withTestLayer(processReminderJob(created.reminderId), layer),
        )

        try {
          await Promise.race([
            gate.reached,
            pending.then(() => {
              throw new Error('Fence was not reached')
            }),
          ])

          const input = {
            requestId: crypto.randomUUID(),
            reminderId: created.reminderId,
            expectedRevision: 1,
          }

          const command =
            operation === 'reschedule_music_reminder'
              ? { operation, input: { ...input, reminderDate: '2030-01-01T00:00:00Z' } }
              : { operation, input }

          const outcome = phase === 'before' ? await f.run(command) : await f.fail(command)
          const inFlight = expect.stringContaining('delivery_may_have_started')

          const expected =
            phase === 'before'
              ? {
                  commandRevision: 2,
                  dispatchState: operation === 'cancel_music_reminder' ? 'cancelled' : 'open',
                }
              : {
                  code: 'conflict',
                  message: inFlight,
                }

          expect(outcome).toMatchObject(expected)

          gate.release()
          await pending
          expect(sent).toHaveLength(phase === 'before' ? 0 : 1)
          const [row] = await f.db.select().from(musicReminder)
          expect(row).toMatchObject({
            commandRevision: phase === 'before' ? 2 : 1,
            dispatchState:
              phase === 'after'
                ? 'accepted'
                : operation === 'cancel_music_reminder'
                  ? 'cancelled'
                  : 'open',
          })
          expect(await Effect.runPromise(withTestLayer(queryDueReminders, layer))).toEqual([])

          const remainsScheduled = operation === 'reschedule_music_reminder' && phase === 'before'
          expect(await Effect.runPromise(withTestLayer(queryNextDueReminder, layer))).toEqual(
            remainsScheduled ? new Date('2030-01-01T00:00:00Z') : null,
          )
          expect(await Effect.runPromise(withTestLayer(getReminderStats, layer))).toMatchObject({
            totalPending: remainsScheduled ? 1 : 0,
            dueNow: 0,
          })
        } finally {
          gate.release()
          await pending
        }
      })
    }
  }

  test('concurrent create and fresh-layer replay schedule one logical reminder; changed payload conflicts', async () => {
    await using f = await fixture()
    const input = create()
    const results = await Promise.all([f.run(input), f.run(input), f.run(input)])
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
    expect(await f.db.select().from(musicReminder)).toHaveLength(1)
    expect(
      await f.run({
        ...input,
        input: { ...input.input, reminderDate: '1970-01-01T00:00:00.000Z' },
      }),
    ).toEqual(results[0])
    expect(
      await f.fail({ ...input, input: { ...input.input, musicTitle: 'Changed' } }),
    ).toMatchObject({ code: 'conflict' })
    expect(JSON.stringify(results)).not.toContain('Private notes')
    expect(JSON.stringify(results)).not.toContain('private.example.test')
  })

  test('observed-revision reschedule and cancellation retain tombstone, original replay and expiry evidence', async () => {
    await using f = await fixture()
    const input = create()
    const created = await f.run(input)
    const observed = (await f.page()).reminders[0]

    if (!observed) throw new Error('Missing observed reminder')
    expect(observed).toMatchObject({ commandRevision: 1, dispatchState: 'open' })

    const edit = {
      operation: 'reschedule_music_reminder',
      input: {
        requestId: crypto.randomUUID(),
        reminderId: created.reminderId,
        expectedRevision: observed.commandRevision,
        reminderDate: '2028-02-29T01:02:03Z',
      },
    }

    const edited = await f.run(edit)
    expect(edited.commandRevision).toBe(2)
    expect((await f.page()).reminders[0]).toMatchObject({
      commandRevision: 2,
      dispatchState: 'open',
    })
    expect(
      await f.fail({ ...edit, input: { ...edit.input, requestId: crypto.randomUUID() } }),
    ).toMatchObject({ code: 'conflict' })

    const cancel = {
      operation: 'cancel_music_reminder',
      input: {
        requestId: crypto.randomUUID(),
        reminderId: created.reminderId,
        expectedRevision: 2,
      },
    }

    const cancelled = await f.run(cancel)
    expect(cancelled).toMatchObject({ commandRevision: 3, dispatchState: 'cancelled' })
    expect((await f.db.select().from(musicReminder))[0]).toMatchObject({
      commandRevision: 3,
      dispatchState: 'cancelled',
      isSent: false,
    })
    expect((await f.page()).reminders[0]).toMatchObject({
      commandRevision: 3,
      dispatchState: 'cancelled',
    })
    expect(await f.run(cancel)).toEqual(cancelled)
    expect(await f.run(edit)).toEqual(edited)
    expect(await f.run(input)).toEqual(created)

    const foreign = await f.fail(
      { ...cancel, input: { ...cancel.input, requestId: crypto.randomUUID() } },
      f.authority('other'),
    )

    expect(foreign).toMatchObject({ code: 'not_found' })
    f.clock.advance(86_400_000)
    expect(await f.fail(input)).toMatchObject({ code: 'expired' })
    expect(await f.db.select().from(musicReminder)).toHaveLength(1)
  })

  test('persisted authority revoked after checkpoint cannot commit a mutation or receipt', async () => {
    await using f = await fixture()
    const gate = gatedPostDatabase(f.database, 'before', /^INSERT INTO music_reminder/i)

    const layer = ReminderCommandServiceLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          DatabaseLayer(gate.database),
          McpOperationStoreLayer(gate.database),
          f.clock.layer,
        ),
      ),
      Layer.provideMerge(f.clock.layer),
    )

    const input = create()

    const pending = Effect.runPromise(
      withTestLayer(
        Effect.flip(
          Effect.flatMap(ReminderCommandService, (service) =>
            service.execute(input, f.authority()),
          ),
        ),
        layer,
      ),
    )

    try {
      await Promise.race([
        gate.reached,
        pending.then(() => {
          throw new Error('Expected atomic mutation gate')
        }),
      ])
      await f.db.update(user).set({ banned: true }).where(eq(user.id, 'owner'))
      gate.release()
      expect(await pending).toMatchObject({ code: 'conflict' })
      expect(await f.db.select().from(musicReminder)).toHaveLength(0)
      expect(await f.database.prepare('SELECT count(*) AS n FROM mcp_operations').first()).toEqual({
        n: 0,
      })
      await f.db.update(user).set({ banned: false }).where(eq(user.id, 'owner'))
      expect(await f.run(input)).toMatchObject({ commandRevision: 1 })
    } finally {
      gate.release()
      await pending
    }
  })

  test('SQL live authority and fresh replay checks fail closed without partial mutation/receipt', async () => {
    await using f = await fixture()
    const input = create()
    const checkpoint = f.authority().checkpoint

    const revokedAtCommit: ReminderAuthority = {
      checkpoint: () =>
        checkpoint(['reminders:write']).pipe(
          Effect.map((identity) => ({
            ...identity,
            liveGuard: sql`0`,
          })),
        ),
    }

    expect(await f.fail(input, revokedAtCommit)).toMatchObject({ code: 'conflict' })
    expect(await f.db.select().from(musicReminder)).toHaveLength(0)
    expect(await f.database.prepare('SELECT count(*) AS n FROM mcp_operations').first()).toEqual({
      n: 0,
    })
    await f.run(input)
    await f.db.update(user).set({ banned: true }).where(eq(user.id, 'owner'))
    expect(await f.fail(input)).toMatchObject({ code: 'access_denied' })
    expect(await f.db.select().from(musicReminder)).toHaveLength(1)
  })
})
