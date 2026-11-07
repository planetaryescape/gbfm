import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database, DatabaseLayer } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { McpActor } from '@/mcp/authorization'
import { makeMcpLayer } from '@/mcp/server'
import { MusicReminderService, MusicReminderServiceLayer } from '@/services/music-reminder.service'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { ListMusicRemindersResult } from './contracts'
import { ReminderReadService, ReminderReadServiceLayer } from './reads'
import { ReminderToolkit, ReminderToolHandlersLayer } from './toolkit'

const principal = (userId = 'listener', scopes = ['reminders:read']) =>
  Schema.decodeUnknownSync(McpPrincipal)({ userId, scopes, clientId: 'reminder-test' })

const fixture = async () => {
  const resource = await createMigratedD1Database()
  const database = DatabaseLayer(resource.database)
  const db = Effect.runSync(withTestLayer(Database, database))
  await db.insert(user).values([
    { id: 'listener', name: 'Listener', email: 'listener@example.test', role: 'user' },
    { id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'admin' },
    { id: 'empty', name: 'Empty', email: 'empty@example.test', role: 'user' },
  ])

  // Reverse insertion order and interleave a foreign row before the first own row.
  const rows = [
    ...Array.from({ length: 52 }, (_, index) => ({
      id: `own-${String(51 - index).padStart(2, '0')}`,
      userId: 'listener',
      musicTitle: `Title ${51 - index}`,
      artistName: 'Artist',
      musicUrl: 'https://private.example.test/music',
      notes: 'private notes',
      reminderDate: new Date(0),
    })),
    {
      id: 'foreign',
      userId: 'admin',
      musicTitle: 'Foreign',
      artistName: 'Other',
      musicUrl: 'https://example.test',
      reminderDate: new Date(-1),
    },
  ]

  // D1 caps bound parameters per statement, so seed one row per statement.
  for (const row of rows) await db.insert(musicReminder).values(row)
  const service = MusicReminderServiceLayer.pipe(Layer.provide(database))
  const reads = ReminderReadServiceLayer.pipe(Layer.provide(service), Layer.provide(database))

  const run = <A, E>(effect: Effect.Effect<A, E, ReminderReadService>, actor = principal()) =>
    Effect.runPromise(withTestLayer(effect, reads).pipe(Effect.provideService(McpActor, actor)))

  const list = (input: { limit?: number; offset?: number } = {}) =>
    Effect.flatMap(ReminderReadService, (service) => service.list(input))

  return { ...resource, db, database, service, reads, run, list }
}

describe('owner-only reminder reads on migrated D1', () => {
  test('defaults, ties, offset, sentinel, maximum and empty pages exclude other owners', async () => {
    await using f = await fixture()
    const first = await f.run(f.list())
    expect(first.pagination).toEqual({ limit: 20, offset: 0, hasMore: true })
    expect(first.reminders.map((row) => row.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `own-${String(index).padStart(2, '0')}`),
    )
    expect(first.reminders[0]).toEqual({
      id: 'own-00',
      musicTitle: 'Title 0',
      artistName: 'Artist',
      reminderDate: '1970-01-01T00:00:00.000Z',
      status: 'pending',
      isSent: false,
    })
    const last = await f.run(f.list({ limit: 2, offset: 50 }))
    expect(last.reminders.map((row) => row.id)).toEqual(['own-50', 'own-51'])
    expect(last.pagination.hasMore).toBe(false)
    expect((await f.run(f.list({ limit: 50 }))).reminders).toHaveLength(50)
    expect(await f.run(f.list({ offset: 52 }))).toEqual({
      reminders: [],
      pagination: { limit: 20, offset: 52, hasMore: false },
    })
    expect((await f.run(f.list(), principal('empty'))).reminders).toEqual([])
    expect((await f.run(f.list(), principal('admin'))).reminders.map((row) => row.id)).toEqual([
      'foreign',
    ])
  })

  test('write scope is not read authority; missing/deleted/banned accounts fail live', async () => {
    await using f = await fixture()

    for (const actor of [
      principal('listener', ['reminders:write']),
      principal('listener', ['catalogue:read']),
      principal('missing'),
    ])
      expect(await f.run(Effect.flip(f.list()), actor)).toMatchObject({ code: 'access_denied' })
    expect(await Effect.runPromise(withTestLayer(Effect.flip(f.list()), f.reads))).toMatchObject({
      code: 'access_denied',
    })
    await f.db.update(user).set({ banned: true }).where(eq(user.id, 'listener'))
    expect(await f.run(Effect.flip(f.list()))).toMatchObject({ code: 'access_denied' })
    await f.db.delete(user).where(eq(user.id, 'listener'))
    expect(await f.run(Effect.flip(f.list()))).toMatchObject({ code: 'access_denied' })
  })

  test('pagination is validated at both MCP service and application service boundaries', async () => {
    await using f = await fixture()

    for (const input of [
      { limit: -1 },
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
      { offset: -1 },
      { offset: 10_001 },
      { offset: NaN },
    ]) {
      expect(await f.run(Effect.flip(f.list(input)))).toMatchObject({ code: 'invalid_input' })

      const result = await Effect.runPromise(
        withTestLayer(
          Effect.flatMap(MusicReminderService, (service) =>
            Effect.flip(service.getPageByUserId('listener', { limit: 20, offset: 0, ...input })),
          ),
          f.service,
        ),
      )

      expect(result._tag).toBe('DatabaseError')
    }
  })

  test('UTF-8 output ceiling rejects an oversized persisted summary without leaking it', async () => {
    await using f = await fixture()
    await f.db
      .update(musicReminder)
      .set({ musicTitle: '🎵'.repeat(70_000) })
      .where(eq(musicReminder.id, 'own-00'))
    const error = await f.run(Effect.flip(f.list({ limit: 1 })))
    expect(error).toMatchObject({ code: 'unavailable' })
    expect(JSON.stringify(error)).not.toContain('🎵')
    expect((await f.run(f.list({ limit: 1, offset: 1 }))).reminders[0]?.id).toBe('own-01')
  })

  test('real MCP HTTP call projects D1 summaries and exposes no placeholder scheduling tools', async () => {
    await using f = await fixture()

    const app = HttpRouter.toWebHandler(
      makeMcpLayer([], ReminderToolkit).pipe(
        Layer.provide(ReminderToolHandlersLayer),
        Layer.provide(f.reads),
        Layer.provide(HttpServer.layerServices),
      ),
      {
        disableLogger: true,
        middleware: (effect) => effect.pipe(Effect.provideService(McpActor, principal())),
      },
    )

    try {
      const response = await app.handler(
        new Request('https://example.test/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/call',
            'mcp-name': 'list_music_reminders',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'list_music_reminders',
              arguments: { limit: 2, offset: 50 },
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        }),
      )

      expect(response.status).toBe(200)
      const text = await response.text()

      const payload =
        text.startsWith('event:') || text.startsWith('data:')
          ? text
              .split('\n')
              .find((line) => line.startsWith('data:'))
              ?.slice(5)
          : text

      if (!payload) throw new Error('Missing MCP response')

      const result = Schema.decodeUnknownSync(
        Schema.Struct({
          result: Schema.Struct({
            structuredContent: ListMusicRemindersResult,
            isError: Schema.optional(Schema.Boolean),
          }),
        }),
      )(JSON.parse(payload))

      expect(result.result.isError).not.toBe(true)
      expect(result.result.structuredContent.reminders.map((row) => row.id)).toEqual([
        'own-50',
        'own-51',
      ])
      expect(Object.keys(ReminderToolkit.tools)).toEqual(['list_music_reminders'])
    } finally {
      await app.dispose()
    }
  })
})
