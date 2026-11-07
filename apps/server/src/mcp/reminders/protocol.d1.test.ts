import { eq } from 'drizzle-orm'
import { Layer, Redacted, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { DatabaseLayer } from '@/db/layer'
import { musicReminder } from '@/db/music-reminder.schema'
import { oauthResource } from '@/db/oauth.schema'
import { makeMcpRoutes } from '@/http/editorial-mcp.routes'
import { AuthLive } from '@/lib/auth'
import { MdxServiceLayer } from '@/lib/mdx'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { RecordingEmailTransportLayer } from '@/services/email-transport.service'
import { MusicReminderServiceLayer } from '@/services/music-reminder.service'
import { PostServiceLayer } from '@/services/post.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'

import { ListMusicRemindersResult } from './contracts'
import { ReminderReadServiceLayer } from './reads'
import { ReminderToolkit, ReminderToolHandlersLayer } from './toolkit'

test('reminder discovery, owner reads, denial and byte budget through persisted OAuth and real MCP routes', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const client = await fixture.register('reminders:read reminders:write offline_access')
  // Disposable fixture policy only; no production policy or shared fixture edits.
  await fixture.db.update(oauthResource).set({
    allowedScopes: JSON.stringify([
      'posts:read',
      'reminders:read',
      'reminders:write',
      'offline_access',
    ]),
  })

  const tokens = async (actor: string, scope: string) =>
    Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(client, await fixture.authorize(client, actor, scope))).json(),
    )

  const reader = await tokens('reader', 'reminders:read offline_access')
  const writer = await tokens('other', 'reminders:write offline_access')
  const full = await tokens('owner', 'reminders:read reminders:write offline_access')
  await fixture.db.insert(musicReminder).values([
    {
      id: 'own',
      userId: 'reader',
      musicTitle: 'Mix',
      artistName: 'Artist',
      musicUrl: 'https://private.example.test',
      notes: 'private note',
      reminderDate: new Date(0),
    },
    {
      id: 'foreign',
      userId: 'owner',
      musicTitle: 'Hidden',
      artistName: 'Other',
      musicUrl: 'https://private.example.test',
      reminderDate: new Date(-1),
    },
  ])

  // Lane-local composition; reuse P1's actual HTTP/OAuth seam, not its shared fixture.
  const base = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
    MdxServiceLayer,
    UploadAssetServiceLayer,
    UnavailableObjectStoreClientLayer,
  ).pipe(Layer.provideMerge(DatabaseLayer(fixture.db.$client)))

  const email = EmailDeliveryLive.pipe(
    Layer.provide(RecordingEmailTransportLayer),
    Layer.provide(base),
  )

  const services = Layer.mergeAll(
    base,
    PostServiceLayer.pipe(Layer.provide(base)),
    EditorialOAuthLive.pipe(Layer.provide(base)),
    AuthLive.pipe(Layer.provide(email), Layer.provide(base)),
    MusicReminderServiceLayer.pipe(Layer.provide(base)),
  )

  const app = HttpRouter.toWebHandler(
    makeMcpRoutes(
      ReminderToolkit,
      ReminderToolHandlersLayer.pipe(Layer.provide(ReminderReadServiceLayer)),
    ).pipe(Layer.provide(services), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  )

  const rpc = async (method: string, args: Schema.Json = {}, token = reader.access_token) => {
    const response = await app.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': method,
          'mcp-name': 'list_music_reminders',
          authorization: `Bearer ${Redacted.value(token)}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params: {
            name: 'list_music_reminders',
            arguments: args,
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
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(256 * 1024)

    const payload =
      text.startsWith('event:') || text.startsWith('data:')
        ? text
            .split('\n')
            .find((line) => line.startsWith('data:'))
            ?.slice(5)
        : text

    if (!payload) throw new Error('Missing MCP response')

    return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(payload)
  }

  const Call = Schema.Struct({
    result: Schema.Struct({
      isError: Schema.Boolean,
      structuredContent: Schema.optional(ListMusicRemindersResult),
      content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
    }),
  })

  try {
    const listing = Schema.decodeUnknownSync(
      Schema.Struct({
        result: Schema.Struct({
          tools: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              annotations: Schema.Struct({
                readOnlyHint: Schema.Boolean,
                destructiveHint: Schema.Boolean,
              }),
              outputSchema: Schema.Json,
            }),
          ),
        }),
      }),
    )(await rpc('tools/list', {}, full.access_token))

    expect(listing.result.tools.map((tool) => tool.name)).toEqual(['list_music_reminders'])

    const writeOnly = Schema.decodeUnknownSync(
      Schema.Struct({
        result: Schema.Struct({
          tools: Schema.Array(Schema.Json),
        }),
      }),
    )(await rpc('tools/list', {}, writer.access_token))

    expect(writeOnly.result.tools).toEqual([])
    expect(listing.result.tools[0]?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
    })
    const outputSchema = JSON.stringify(listing.result.tools[0]?.outputSchema)

    for (const field of ['notes', 'musicUrl', 'userId'])
      expect(outputSchema).not.toContain(`"${field}"`)
    const own = Schema.decodeUnknownSync(Call)(await rpc('tools/call'))
    expect(own.result.structuredContent?.reminders.map((row) => row.id)).toEqual(['own'])
    const denial = Schema.decodeUnknownSync(Call)(await rpc('tools/call', {}, writer.access_token))
    expect(denial.result.isError).toBe(true)
    expect(denial.result.content[0]?.text).toContain('access_denied')

    // Escape-heavy and multibyte JSON just below the inner 64 KiB budget.
    const nearBudget = '\\"🎵'.repeat(8_000)
    await fixture.db
      .update(musicReminder)
      .set({ musicTitle: nearBudget })
      .where(eq(musicReminder.id, 'own'))
    const near = Schema.decodeUnknownSync(Call)(await rpc('tools/call', { limit: 1 }))
    expect(near.result.isError).toBe(false)
    expect(near.result.structuredContent?.reminders[0]?.musicTitle).toBe(nearBudget)
    // This result fits the former 256 KiB result check but not the outer envelope.
    await fixture.db
      .update(musicReminder)
      .set({ musicTitle: '\\"🎵'.repeat(30_000) })
      .where(eq(musicReminder.id, 'own'))
    const oversized = Schema.decodeUnknownSync(Call)(await rpc('tools/call', { limit: 1 }))
    expect(oversized.result.isError).toBe(true)
    expect(oversized.result.content[0]?.text).toContain('result-payload limit')
    expect(oversized.result.content[0]?.text).not.toContain('🎵')
  } finally {
    await app.dispose()
  }
}, 30_000)
