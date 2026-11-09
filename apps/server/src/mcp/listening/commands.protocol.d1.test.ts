import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { DatabaseTestLayer, db, d1 } from '@/test/database'

import { McpActor } from '../authorization'
import { CommandAuthority } from '../command-authority'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { McpOperationStoreLayer } from '../operations/store'
import { composeMcpToolkits, makeMcpLayer } from '../server'
import { ListeningCommandToolHandlersLayer, ListeningCommandToolkit } from './command-tools'
import { ListeningCommandServiceLive } from './commands'
import { SavedMixCommandResult } from './contracts'
import { ListeningReadServiceLive } from './reads'
import { listeningTestSessionAuthority } from './test-session'
import { ListeningToolHandlersLayer, ListeningToolkit } from './tools'

const owner = 'listening-protocol-command-owner'

const config = Schema.decodeUnknownSync(EditorialMcpSettings)({
  readScope: 'posts:read',
  environment: 'test',
  resourceUrl: 'https://fixture.test/mcp',
  frontendUrl: 'https://fixture.test',
})

// Injected-principal protocol proof only. P1 owns real persisted-OAuth composition.
const web = HttpRouter.toWebHandler(
  makeMcpLayer([], composeMcpToolkits(ListeningToolkit, ListeningCommandToolkit)).pipe(
    Layer.provide(
      Layer.mergeAll(
        ListeningToolHandlersLayer.pipe(Layer.provide(ListeningReadServiceLive)),
        ListeningCommandToolHandlersLayer.pipe(Layer.provide(ListeningCommandServiceLive)),
      ),
    ),
    Layer.provide(DatabaseTestLayer),
    Layer.provide(McpOperationStoreLayer(d1)),
    Layer.provide(Layer.succeed(EditorialMcpConfig, config)),
    Layer.provide(HttpServer.layerServices),
  ),
  {
    disableLogger: true,
    middleware: (effect) =>
      Effect.gen(function* () {
        const authority = yield* listeningTestSessionAuthority(owner).pipe(
          Effect.provideService(Database, db),
        )

        return yield* effect.pipe(
          Effect.provideService(CommandAuthority, authority),
          Effect.provideService(
            McpActor,
            yield* Schema.decodeUnknownEffect(McpPrincipal)({
              userId: owner,
              clientId: 'listening-protocol-client',
              scopes: ['listening:read', 'listening:write'],
            }),
          ),
        )
      }),
  },
)

beforeAll(async () => {
  await db
    .insert(user)
    .values({ id: owner, name: 'Fixture', email: 'listening-protocol@example.test', role: 'user' })
  await db.insert(session).values({
    id: `${owner}-session`,
    userId: owner,
    token: `${owner}-token`,
    expiresAt: new Date(Date.now() + 3600000),
    updatedAt: new Date(),
  })
})

afterAll(() => web.dispose())

const rpc = async (method: string, params: Schema.Json) => {
  const parameters = Schema.decodeUnknownSync(Schema.JsonObject)(params)

  const { name } = Schema.decodeUnknownSync(
    Schema.Struct({ name: Schema.optionalKey(Schema.String) }),
  )(parameters)

  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
  })

  if (name !== undefined) headers.set('mcp-name', name)

  const response = await web.handler(
    new Request('https://fixture.test/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...parameters,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  )

  const text = await response.text()

  if (response.status !== 200) throw new Error(`Unexpected MCP status ${response.status}: ${text}`)

  const payload =
    text.startsWith('event:') || text.startsWith('data:')
      ? text
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
      : text

  if (!payload) throw new Error('Missing MCP response')

  const envelope = Schema.decodeUnknownSync(Schema.Struct({ result: Schema.Unknown }))(
    JSON.parse(payload),
  )

  return envelope.result
}

test('all eight capabilities discover and every command rejects owner/publication excess at tools/call', async () => {
  const listing = Schema.decodeUnknownSync(
    Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
  )(await rpc('tools/list', {}))

  expect(listing.tools.map((tool) => tool.name).sort()).toEqual([
    'create_collection',
    'list_collections',
    'list_saved_mixes',
    'save_mix',
    'set_collection_membership',
    'set_listening_status',
    'update_collection',
    'update_listening_notes',
  ])
  const requestId = crypto.randomUUID()

  const saveCommand = {
    name: 'save_mix',
    arguments: { requestId, url: 'https://soundcloud.com/l1-protocol/mix', title: 'Private' },
  }

  const commands: ReadonlyArray<{ readonly name: string; readonly arguments: Schema.JsonObject }> =
    [
      saveCommand,
      { name: 'create_collection', arguments: { requestId, title: 'Private' } },
      {
        name: 'update_listening_notes',
        arguments: { requestId, mixId: 'missing', expectedVersion: 'revision:1', notes: '' },
      },
      {
        name: 'set_listening_status',
        arguments: {
          requestId,
          mixId: 'missing',
          expectedVersion: 'revision:1',
          status: 'listened',
        },
      },
      {
        name: 'update_collection',
        arguments: {
          requestId,
          collectionId: 'missing',
          expectedVersion: 'revision:1',
          description: '',
        },
      },
      {
        name: 'set_collection_membership',
        arguments: {
          requestId,
          collectionId: 'missing',
          mixId: 'missing',
          expectedVersion: 'revision:1',
          included: false,
        },
      },
    ]

  const excesses: ReadonlyArray<Schema.JsonObject> = [{ published: true }, { userId: 'victim' }]

  for (const command of commands) {
    for (const excess of excesses) {
      const response = Schema.decodeUnknownSync(
        Schema.Struct({
          isError: Schema.Boolean,
          content: Schema.Array(
            Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
          ),
        }),
      )(
        await rpc('tools/call', {
          name: command.name,
          arguments: Object.assign({}, command.arguments, excess),
        }),
      )

      expect(response.isError).toBe(true)
      expect(response.content.map((item) => item.text).join(' ')).toContain(
        'Expected no excess property',
      )
    }
  }

  const saved = Schema.decodeUnknownSync(
    Schema.Struct({ structuredContent: SavedMixCommandResult }),
  )(await rpc('tools/call', saveCommand)).structuredContent

  expect(saved.version).toBe('revision:1')
  expect(Object.keys(saved).sort()).toEqual(['mixId', 'version'])
})
