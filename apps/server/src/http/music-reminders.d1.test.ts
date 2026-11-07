import { MusicRemindersGroup } from '@gbfm/api/music-reminders'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApi, HttpApiBuilder } from 'effect/http-api'
import * as Path from 'effect/Path'
import { expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { DatabaseLayer, makeDatabaseClient } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { AuthLive } from '@/lib/auth'
import { McpOperationStoreLayer } from '@/mcp/operations/store'
import { ReminderCommandServiceLayer } from '@/mcp/reminders/service'
import { AuthMiddlewareLive } from '@/middleware/auth.impl'
import { ConfigService, createConfig } from '@/services/config.service'
import { EmailDelivery } from '@/services/email-delivery.service'
import { MusicReminderServiceLayer } from '@/services/music-reminder.service'
import { ReminderSignalService } from '@/services/reminder-signal.service'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { MusicRemindersHandlersLive } from './music-reminders.handlers'

const fixture = async () => {
  const resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  const now = new Date()

  for (const id of ['owner', 'other']) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.test`, role: 'user' })
    await db.insert(session).values({
      id: `${id}-session`,
      token: `${id}-disposable-token`,
      userId: id,
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    })
  }

  const defaults = createConfig()

  const base = Layer.mergeAll(
    DatabaseLayer(resource.database),
    McpOperationStoreLayer(resource.database),
    Layer.succeed(ConfigService, {
      ...defaults,
      auth: { ...defaults.auth, betterAuthSecret: 'disposable-reminder-test-secret-32-chars' },
    }),
    // No delivery or provider is allowed in the HTTP proof.
    Layer.succeed(EmailDelivery, { deliver: () => Effect.die('Unexpected email delivery') }),
  )

  let signals = 0

  const dependencies = Layer.mergeAll(
    ReminderCommandServiceLayer,
    MusicReminderServiceLayer,
    AuthMiddlewareLive.pipe(Layer.provide(AuthLive)),
    Layer.succeed(ReminderSignalService, {
      signal: Effect.sync(() => {
        signals++
      }),
      await: Effect.void,
    }),
  ).pipe(Layer.provideMerge(base))

  const handler = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(HttpApi.make('gbfm').add(MusicRemindersGroup)).pipe(
      Layer.provide(MusicRemindersHandlersLive),
      Layer.provideMerge(dependencies),
      Layer.provideMerge(
        Layer.mergeAll(FileSystem.layerNoop({}), Path.layer).pipe(
          Layer.provideMerge(HttpServer.layerServices),
        ),
      ),
    ),
    { disableLogger: true },
  )

  const request = (method: string, path = '', body?: Schema.Json, actor = 'owner') => {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${actor}-disposable-token`,
        'content-type': 'application/json',
      },
    }

    if (body !== undefined) init.body = JSON.stringify(body)

    return handler.handler(
      new Request(`https://reminders.example.test/api/music-reminders${path}`, init),
    )
  }

  return {
    db,
    request,
    signals: () => signals,
    [Symbol.asyncDispose]: async () => {
      await handler.dispose()
      await resource.dispose()
    },
  }
}

const ReceiptResponse = Schema.Struct({
  reminder: Schema.Struct({
    reminderId: Schema.String,
    commandRevision: Schema.Number,
    dispatchState: Schema.String,
    reminderDate: Schema.String,
  }),
})

const createInput = () => ({
  requestId: crypto.randomUUID(),
  musicTitle: 'Night',
  artistName: 'DJ',
  musicUrl: 'https://private.example.test/mix',
  reminderDate: '2030-01-01T00:00:00Z',
  notes: 'private note',
  albumCoverUrl: 'https://private.example.test/cover',
})

test('real session HTTP writes require observed revisions and replay bounded original receipts', async () => {
  await using f = await fixture()
  const input = createInput()
  const created = await f.request('POST', '', input)
  expect(created.status).toBe(200)
  const receipt = Schema.decodeUnknownSync(ReceiptResponse)(await created.json()).reminder
  expect(receipt.commandRevision).toBe(1)
  const path = `/${receipt.reminderId}`
  expect((await f.request('POST', '', input)).status).toBe(200)
  expect(await f.db.select().from(musicReminder)).toHaveLength(1)
  expect(await (await f.request('GET')).json()).toMatchObject({
    reminders: [{ id: receipt.reminderId, commandRevision: 1, dispatchState: 'open' }],
  })
  expect(
    (await f.request('PUT', path, { requestId: crypto.randomUUID(), notes: 'edit' })).status,
  ).toBe(428)
  expect((await f.request('DELETE', path, { requestId: crypto.randomUUID() })).status).toBe(428)
  expect((await f.request('DELETE', path)).status).toBe(400)
  expect(
    (
      await f.request(
        'PUT',
        path,
        {
          requestId: crypto.randomUUID(),
          expectedRevision: 1,
          notes: 'steal',
        },
        'other',
      )
    ).status,
  ).toBe(404)
  const edit = { requestId: crypto.randomUUID(), expectedRevision: 1, notes: null }
  const updated = await f.request('PUT', path, edit)
  expect(updated.status).toBe(200)
  expect(await updated.json()).toMatchObject({ reminder: { commandRevision: 2 } })
  expect(await f.db.select().from(musicReminder)).toMatchObject([
    {
      notes: null,
      musicTitle: 'Night',
      albumCoverUrl: input.albumCoverUrl,
    },
  ])
  expect(
    (await f.request('DELETE', path, { requestId: crypto.randomUUID(), expectedRevision: 1 }))
      .status,
  ).toBe(409)
  const cancel = { requestId: crypto.randomUUID(), expectedRevision: 2 }
  expect((await f.request('DELETE', path, cancel)).status).toBe(200)
  expect((await f.request('DELETE', path, cancel)).status).toBe(200)
  const replay = await f.request('PUT', path, edit)
  expect(replay.status).toBe(200)
  expect(await replay.json()).toMatchObject({
    reminder: { commandRevision: 2, dispatchState: 'open' },
  })
  expect(await f.db.select().from(musicReminder)).toMatchObject([
    { commandRevision: 3, dispatchState: 'cancelled' },
  ])
  expect(JSON.stringify(receipt)).not.toContain('private')
  expect(f.signals()).toBeGreaterThan(0)
}, 20_000)

test('fenced HTTP writes explain non-recall and revoked sessions cannot replay', async () => {
  await using f = await fixture()
  const input = createInput()
  const created = await f.request('POST', '', input)
  expect(created.status).toBe(200)
  const receipt = Schema.decodeUnknownSync(ReceiptResponse)(await created.json()).reminder
  await f.db
    .update(musicReminder)
    .set({ dispatchState: 'fenced' })
    .where(eq(musicReminder.id, receipt.reminderId))

  const denied = await f.request('DELETE', `/${receipt.reminderId}`, {
    requestId: crypto.randomUUID(),
    expectedRevision: 1,
  })

  expect(denied.status).toBe(409)
  expect(await denied.json()).toMatchObject({
    message: expect.stringContaining('delivery_may_have_started'),
  })
  await f.db.delete(session).where(eq(session.id, 'owner-session'))
  expect((await f.request('POST', '', input)).status).toBe(401)
  expect(await f.db.select().from(musicReminder)).toHaveLength(1)
}, 20_000)
