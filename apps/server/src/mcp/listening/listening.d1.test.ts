import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import {
  listeningCollectionsTable as collections,
  savedMixesTable as mixes,
} from '@/db/listening.schema'
import { DatabaseTestLayer, db } from '@/test/database'

import { McpActor } from '../authorization'
import { composeMcpToolkits, makeMcpLayer } from '../server'
import { CollectionPage, SavedMixPage } from './contracts'
import { ListeningReadServiceLive } from './reads'
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

  for (const [id, userId] of [
    ['a', owner],
    ['b', owner],
    ['c', owner],
    ['z', other],
  ] as const) {
    await db.insert(mixes).values({
      id,
      userId,
      url: `https://soundcloud.com/test/${id}`,
      platform: 'soundcloud',
      title: id,
      notes: `${id}-private-note`,
      createdAt: 100,
    })
    await db.insert(collections).values({ id, userId, title: `${id}-collection`, createdAt: 100 })
  }
})

test('listener-only protocol reads paginate only the owner, including private notes, with no global counts', async () => {
  const first = await call('list_saved_mixes', { limit: 2 })
  expect(first.isError).not.toBe(true)
  const page = Schema.decodeUnknownSync(SavedMixPage)(first.structuredContent)
  expect(page.mixes.map((mix) => mix.id)).toEqual(['c', 'b'])
  expect(page.mixes.map((mix) => mix.notes)).toEqual(['c-private-note', 'b-private-note'])
  expect(page.pagination).toEqual({ limit: 2, offset: 0, hasMore: true })

  const last = Schema.decodeUnknownSync(SavedMixPage)(
    (await call('list_saved_mixes', { limit: 2, offset: 2 })).structuredContent,
  )

  expect(last.mixes.map((mix) => mix.id)).toEqual(['a'])
  expect(last.pagination.hasMore).toBe(false)

  const collectionPage = Schema.decodeUnknownSync(CollectionPage)(
    (await call('list_collections', { limit: 2, offset: 1 })).structuredContent,
  )

  expect(collectionPage.collections.map((collection) => collection.id)).toEqual(['b', 'a'])
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
