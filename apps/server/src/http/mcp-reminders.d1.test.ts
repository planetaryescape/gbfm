import { eq } from 'drizzle-orm'
import { Layer, Redacted, Schema } from 'effect'
import { expect, test } from 'vitest'

import { musicReminder } from '@/db/music-reminder.schema'
import { oauthResource } from '@/db/oauth.schema'
import { ReminderCommandResult } from '@/mcp/reminders/contracts'
import { ConfigService } from '@/services/config.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { createTestWebHandler } from '@/test/http-handler'

const commandNames = ['create_music_reminder', 'reschedule_music_reminder', 'cancel_music_reminder']

const fixture = async () => {
  const f = await createEditorialOAuthFixture()
  const scopes = 'reminders:read reminders:write offline_access'
  const client = await f.register(scopes)
  await f.db.update(oauthResource).set({ allowedScopes: JSON.stringify(scopes.split(' ')) })

  const tokens = async (actor: string, scope: string) =>
    Schema.decodeUnknownSync(OAuthTokens)(
      await (await f.exchange(client, await f.authorize(client, actor, scope))).json(),
    )

  const writer = await tokens('reader', scopes)
  const reader = await tokens('reader', 'reminders:read offline_access')
  const other = await tokens('other', scopes)
  const writeOnly = await tokens('owner', 'reminders:write offline_access')

  const config = Layer.succeed(ConfigService, {
    ...f.config,
    auth: {
      ...f.config.auth,
      betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
    },
  })

  const makeApp = () => createTestWebHandler(f.database, undefined, undefined, undefined, config)
  let app = makeApp()

  const rpc = async (
    method: string,
    name = '',
    args: Schema.Json = {},
    token = writer.access_token,
  ) => {
    const response = await app.handler(
      new Request(f.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': method,
          'mcp-name': name,
          authorization: `Bearer ${Redacted.value(token)}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params: {
            name,
            arguments: args,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    )

    const text = await response.text()

    return {
      status: response.status,
      body:
        text.length === 0
          ? null
          : Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(text),
    }
  }

  return {
    ...f,
    writer,
    reader,
    other,
    writeOnly,
    rpc,
    call: (name: string, args: Schema.Json, token = writer.access_token) =>
      rpc('tools/call', name, args, token),
    restart: async () => {
      await app.dispose()
      app = makeApp()
    },
    [Symbol.asyncDispose]: async () => {
      await app.dispose()
      await f[Symbol.asyncDispose]()
    },
  }
}

const input = () => ({
  requestId: crypto.randomUUID(),
  musicTitle: 'Nothing Is Still',
  artistName: 'Leon Vynehall',
  musicUrl: 'https://open.spotify.com/album/6WeIO0CpDMiMXTglv0KuLr',
  reminderDate: '2030-01-01T10:00:00.000Z',
  notes: "I've liked one song at a time randomly over the years.",
})

const result = (body: Schema.Json | undefined) =>
  Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: ReminderCommandResult }) }),
  )(body).result.structuredContent

const denied = (code: string) => ({
  result: { isError: true, content: [{ text: expect.stringContaining(code) }] },
})

test('production MCP discovery and writes require independent reminder consent, including for listeners', async () => {
  await using h = await fixture()

  const listing = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        tools: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            annotations: Schema.Struct({
              readOnlyHint: Schema.Boolean,
              idempotentHint: Schema.Boolean,
              openWorldHint: Schema.Boolean,
            }),
          }),
        ),
      }),
    }),
  )

  const writer = listing((await h.rpc('tools/list')).body).result.tools
  expect(writer.map((tool) => tool.name)).toEqual(expect.arrayContaining(commandNames))

  for (const tool of writer.filter((tool) => commandNames.includes(tool.name)))
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
    })

  const reader = listing(
    (await h.rpc('tools/list', '', {}, h.reader.access_token)).body,
  ).result.tools.map((tool) => tool.name)

  expect(reader).toContain('list_music_reminders')

  for (const name of commandNames) {
    expect(reader).not.toContain(name)
    expect((await h.call(name, input(), h.reader.access_token)).body).toMatchObject(
      denied('access_denied'),
    )
  }

  const writeOnly = listing(
    (await h.rpc('tools/list', '', {}, h.writeOnly.access_token)).body,
  ).result.tools.map((tool) => tool.name)

  expect(writeOnly).toEqual(expect.arrayContaining(commandNames))
  expect(writeOnly).not.toContain('list_music_reminders')
  expect(
    result((await h.call('create_music_reminder', input(), h.writeOnly.access_token)).body),
  ).toMatchObject({ commandRevision: 1, dispatchState: 'open' })
}, 15_000)

test('MCP create survives restart and concurrent retries; reschedule and cancellation preserve original receipts', async () => {
  await using h = await fixture()
  const create = input()

  const responses = await Promise.all([
    h.call('create_music_reminder', create),
    h.call('create_music_reminder', create),
  ])

  const original = result(responses[0]?.body)
  expect(result(responses[1]?.body)).toEqual(original)
  expect(await h.db.select().from(musicReminder)).toHaveLength(1)
  await h.restart()
  expect(result((await h.call('create_music_reminder', create)).body)).toEqual(original)
  expect(
    (await h.call('create_music_reminder', { ...create, notes: 'Changed' })).body,
  ).toMatchObject(denied('conflict'))

  const move = {
    requestId: crypto.randomUUID(),
    reminderId: original.reminderId,
    expectedRevision: original.commandRevision,
    reminderDate: '2030-02-01T10:00:00.000Z',
  }

  const moved = result((await h.call('reschedule_music_reminder', move)).body)
  expect(moved).toMatchObject({ commandRevision: 2, reminderDate: move.reminderDate })
  expect(
    (await h.call('reschedule_music_reminder', { ...move, requestId: crypto.randomUUID() })).body,
  ).toMatchObject(denied('conflict'))

  const cancel = {
    requestId: crypto.randomUUID(),
    reminderId: original.reminderId,
    expectedRevision: moved.commandRevision,
  }

  const cancelled = result((await h.call('cancel_music_reminder', cancel)).body)
  expect(cancelled).toMatchObject({ commandRevision: 3, dispatchState: 'cancelled' })
  await h.restart()
  expect(result((await h.call('cancel_music_reminder', cancel)).body)).toEqual(cancelled)
  expect(result((await h.call('create_music_reminder', create)).body)).toEqual(original)
  expect(result((await h.call('reschedule_music_reminder', move)).body)).toEqual(moved)
  const rows = await h.db.select().from(musicReminder)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ userId: 'reader', dispatchState: 'cancelled', isSent: false })
}, 15_000)

test('MCP commands reject invalid dates and missing revisions, hide foreign reminders and refuse recall after dispatch', async () => {
  await using h = await fixture()

  for (const reminderDate of ['2030-02-30T10:00:00Z', '2030-01-01T10:00:00', 'tomorrow']) {
    const response = await h.call('create_music_reminder', { ...input(), reminderDate })
    expect(response.body).toMatchObject({ result: { isError: true } })
  }

  for (const fields of [
    { userId: 'other' },
    { recipient: 'other@example.com' },
    { email: 'other@example.com' },
  ]) {
    expect((await h.call('create_music_reminder', { ...input(), ...fields })).body).toMatchObject({
      result: { isError: true },
    })
  }

  expect(await h.db.select().from(musicReminder)).toHaveLength(0)
  const original = result((await h.call('create_music_reminder', input())).body)

  const cancel = {
    requestId: crypto.randomUUID(),
    reminderId: original.reminderId,
    expectedRevision: original.commandRevision,
  }

  expect(
    (
      await h.call('cancel_music_reminder', {
        requestId: crypto.randomUUID(),
        reminderId: original.reminderId,
      })
    ).body,
  ).toMatchObject({ result: { isError: true } })
  expect((await h.call('cancel_music_reminder', cancel, h.other.access_token)).body).toMatchObject(
    denied('not_found'),
  )
  await h.db
    .update(musicReminder)
    .set({ dispatchState: 'fenced' })
    .where(eq(musicReminder.id, original.reminderId))
  expect((await h.call('cancel_music_reminder', cancel)).body).toMatchObject(
    denied('delivery_may_have_started'),
  )
  expect(
    (
      await h.call('reschedule_music_reminder', {
        ...cancel,
        requestId: crypto.randomUUID(),
        reminderDate: '2030-02-01T10:00:00Z',
      })
    ).body,
  ).toMatchObject(denied('delivery_may_have_started'))
}, 15_000)

test('removing reminder write policy blocks fresh calls and receipt replay without expanding existing grants', async () => {
  await using h = await fixture()
  const create = input()
  result((await h.call('create_music_reminder', create)).body)
  await h.db.update(oauthResource).set({
    allowedScopes: JSON.stringify(['reminders:read', 'offline_access']),
    policyVersion: 2,
  })

  for (const args of [create, input()]) {
    const response = await h.call('create_music_reminder', args)
    expect(response.status).toBe(401)
    expect(JSON.stringify(response.body)).not.toContain('reminderId')
  }

  expect(await h.db.select().from(musicReminder)).toHaveLength(1)
}, 15_000)
