import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Logger, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { DatabaseLayer } from '@/db/layer'
import {
  listeningCollectionsTable as collections,
  savedMixesTable as mixes,
} from '@/db/listening.schema'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { McpActor } from '../authorization'
import { composeMcpToolkits, makeMcpLayer } from '../server'
import { CollectionPage, SavedMixPage } from './contracts'
import { ListeningReadService, ListeningReadServiceLive } from './reads'
import { ListeningToolHandlersLayer, ListeningToolkit } from './tools'

const owner = 'l1-owner'

const other = 'l1-other'

// Protocol/authorization fixture, NOT persisted OAuth proof. P1 owns the real OAuth composition.
const app = (actor = owner, scopes: typeof McpPrincipal.Type.scopes = ['listening:read']) =>
  HttpRouter.toWebHandler(
    makeMcpLayer([], composeMcpToolkits(ListeningToolkit)).pipe(
      Layer.provide(ListeningToolHandlersLayer),
      Layer.provide(ListeningReadServiceLive),
      Layer.provide(DatabaseTestLayer),
      Layer.provide(HttpServer.layerServices),
    ),
    {
      disableLogger: true,
      middleware: (effect) =>
        effect.pipe(
          Effect.provideService(
            McpActor,
            Schema.decodeUnknownSync(McpPrincipal)({
              userId: actor,
              clientId: 'l1-fixture',
              scopes,
            }),
          ),
        ),
    },
  )

const web = app()

const wrongScope = app(owner, ['listening:write'])

const otherWeb = app(other)

afterAll(async () => {
  await Promise.all([web.dispose(), wrongScope.dispose(), otherWeb.dispose()])
})

const envelope = Schema.Struct({
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
})

const result = Schema.Struct({
  isError: Schema.optionalKey(Schema.Boolean),
  structuredContent: Schema.optionalKey(Schema.Unknown),
  content: Schema.Array(
    Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
  ),
})

const rpc = async (
  method: string,
  params: { readonly name?: string; readonly arguments?: Schema.Json },
  handler = web.handler,
) => {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
  })

  if (params.name) headers.set('mcp-name', params.name)

  const response = await handler(
    new Request('https://example.test/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
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

  return Schema.decodeUnknownSync(envelope)(JSON.parse(payload))
}

const call = async (name: string, args: Schema.Json = {}, handler = web.handler) => {
  const response = await rpc('tools/call', { name, arguments: args }, handler)
  expect(response.error).toBeUndefined()

  return Schema.decodeUnknownSync(result)(response.result)
}

beforeAll(async () => {
  await db
    .insert(user)
    .values(
      [owner, other].map((id) => ({ id, name: id, email: `${id}@example.test`, role: 'user' })),
    )

  for (const [id, userId, createdAt] of [
    ['a', owner, 300],
    ['b', owner, 100],
    ['c', owner, 100],
    ['z', other, 200],
  ] as const) {
    await db.insert(mixes).values({
      id,
      userId,
      url: `https://soundcloud.com/test/${id}`,
      platform: 'soundcloud',
      title: id,
      notes: `${id}-private-note`,
      createdAt,
    })
    await db.insert(collections).values({ id, userId, title: `${id}-collection`, createdAt })
  }
})

test('listener-only protocol reads paginate only the owner, including private notes, with no global counts', async () => {
  const first = await call('list_saved_mixes', { limit: 2 })
  expect(first.isError).not.toBe(true)
  const page = Schema.decodeUnknownSync(SavedMixPage)(first.structuredContent)
  expect(page.mixes.map((mix) => mix.id)).toEqual(['a', 'c'])
  expect(page.mixes.map((mix) => mix.notes)).toEqual(['a-private-note', 'c-private-note'])
  expect(page.pagination).toEqual({ limit: 2, offset: 0, hasMore: true })

  const last = Schema.decodeUnknownSync(SavedMixPage)(
    (await call('list_saved_mixes', { limit: 2, offset: 2 })).structuredContent,
  )

  expect(last.mixes.map((mix) => mix.id)).toEqual(['b'])
  expect(last.pagination.hasMore).toBe(false)

  const collectionPage = Schema.decodeUnknownSync(CollectionPage)(
    (await call('list_collections', { limit: 2, offset: 1 })).structuredContent,
  )

  expect(collectionPage.collections.map((collection) => collection.id)).toEqual(['c', 'b'])
  expect(collectionPage.pagination.hasMore).toBe(false)
  expect(JSON.stringify(collectionPage)).not.toContain('count')

  const otherPage = Schema.decodeUnknownSync(SavedMixPage)(
    (await call('list_saved_mixes', {}, otherWeb.handler)).structuredContent,
  )

  expect(otherPage.mixes.map((mix) => mix.id)).toEqual(['z'])
  expect(JSON.stringify(otherPage)).not.toContain('c-private-note')
})

test('protocol rejects out-of-bounds pages; writes are not exposed', async () => {
  for (const args of [{ limit: 0 }, { limit: 51 }, { offset: -1 }, { offset: 10001 }]) {
    const response = await rpc('tools/call', { name: 'list_saved_mixes', arguments: args })
    expect(
      response.error !== undefined ||
        Schema.decodeUnknownSync(result)(response.result).isError === true,
    ).toBe(true)
  }

  const response = await rpc('tools/list', {})

  const tools = Schema.decodeUnknownSync(
    Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
  )(response.result)

  expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
    'list_collections',
    'list_saved_mixes',
  ])
})

test('current scope and persisted banned state deny private reads', async () => {
  const denied = await call('list_collections', {}, wrongScope.handler)
  expect(denied.isError).toBe(true)
  expect(JSON.stringify(denied)).toContain('access_denied')
  await db.update(user).set({ banned: true }).where(eq(user.id, owner))

  try {
    const banned = await call('list_saved_mixes')
    expect(banned.isError).toBe(true)
    expect(JSON.stringify(banned)).not.toContain('private-note')
  } finally {
    await db.update(user).set({ banned: false }).where(eq(user.id, owner))
  }
})

test('read failures distinguish database from projection in value-free diagnostics', async () => {
  await using resource = await createMigratedD1Database()
  const database = resource.database
  const logs: Array<{ readonly message: unknown; readonly cause: unknown }> = []

  const principal = Schema.decodeUnknownSync(McpPrincipal)({
    userId: owner,
    clientId: 'l1-fixture',
    scopes: ['listening:read'],
  })

  const layer = ListeningReadServiceLive.pipe(
    Layer.provide(DatabaseLayer(database)),
    Layer.provideMerge(
      Logger.layer([Logger.make(({ message, cause }) => logs.push({ message, cause }))]),
    ),
  )

  await database
    .prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)')
    .bind(owner, 'PRIVATE-NAME', 'private@example.test')
    .run()
  await database
    .prepare(
      "INSERT INTO saved_mixes (id, user_id, url, platform, title, notes, created_at) VALUES ('bad', ?, 'PRIVATE-URL', 'soundcloud', X'0102', 'PRIVATE-NOTES', 0)",
    )
    .bind(owner)
    .run()
  await database
    .prepare(
      "INSERT INTO listening_collections (id, user_id, title, created_at) VALUES ('bad', ?, X'0102', 0)",
    )
    .bind(owner)
    .run()

  const read = (kind: 'mixes' | 'collections') =>
    Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const service = yield* ListeningReadService

          return yield* (
            kind === 'mixes'
              ? Effect.asVoid(service.listSavedMixes({}))
              : Effect.asVoid(service.listCollections({}))
          ).pipe(
            Effect.match({
              onSuccess: () => 'unexpected success',
              onFailure: (error) => error.code,
            }),
          )
        }).pipe(Effect.provideService(McpActor, principal)),
        layer,
      ),
    )

  for (const kind of ['mixes', 'collections'] as const) expect(await read(kind)).toBe('unavailable')
  expect(logs.map((log) => log.message)).toEqual([
    [
      'mcp.listening.projection_invalid',
      { operation: 'saved_mixes.list', dependency: 'projection' },
    ],
    [
      'mcp.listening.projection_invalid',
      { operation: 'collections.list', dependency: 'projection' },
    ],
  ])
  expect(JSON.stringify(logs)).not.toContain('PRIVATE')
  logs.length = 0
  await database.prepare('DROP TABLE listening_memberships').run()
  await database.prepare('DROP TABLE saved_mixes').run()
  await database.prepare('DROP TABLE listening_collections').run()

  for (const kind of ['mixes', 'collections'] as const) expect(await read(kind)).toBe('unavailable')
  expect(logs.map((log) => log.message)).toEqual([
    ['mcp.listening.unavailable', { operation: 'saved_mixes.list', dependency: 'database' }],
    ['mcp.listening.unavailable', { operation: 'collections.list', dependency: 'database' }],
  ])
  expect(JSON.stringify(logs)).not.toContain('PRIVATE')
})
