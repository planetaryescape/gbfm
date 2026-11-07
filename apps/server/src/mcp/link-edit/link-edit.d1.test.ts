import { AuthSession } from '@gbfm/api/middleware/auth'
import { sql } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { Database, DatabaseLayer, makeDatabaseClient } from '@/db/layer'
import { MUSIC_PLATFORMS } from '@/db/music-entity.schema'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { musicLinkStatements } from '@/services/canonical-music-identity/link-statements'
import { parseMusicSource } from '@/services/canonical-music-identity/music-source'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuth } from '@/services/editorial-oauth.service'
import { createEditorialOAuthFixture } from '@/test/editorial-oauth'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'

import {
  CommandAuthority,
  makeOAuthCommandAuthority,
  makeSessionCommandAuthority,
} from '../command-authority'
import { McpToolError } from '../contracts'
import { createMcpOperationStore, McpOperationStoreLayer } from '../operations/store'
import { makeMcpLayer } from '../server'
import { LinkEditResult } from './contracts'
import { applyMusicLink } from './executor'
import { LinkEditHandlersLayer, LinkEditToolkit } from './toolkit'

const fixture = async () => {
  const resource = await createMigratedD1Database()
  const d1 = resource.database
  const db = DatabaseLayer(d1)
  await seedMusicLookups(makeDatabaseClient(d1))
  await d1.batch([
    d1.prepare(`INSERT INTO user(id,name,email,created_at,updated_at,role,banned)
      VALUES ('editor','Editor','u1@example.test',1,1,'admin',0)`),
    d1.prepare(`CREATE TABLE u1_grant (enabled INTEGER NOT NULL)`),
    d1.prepare(`INSERT INTO u1_grant VALUES (1)`),
    d1.prepare(`INSERT INTO music_tracks (id,title,slug,createdAt,updatedAt)
      VALUES ('t','Target','t',1,1),('other','Other','other',1,1)`),
  ])

  const authority = Layer.succeed(CommandAuthority, {
    checkpoint: (scopes) =>
      Effect.gen(function* () {
        const enabled = yield* Effect.promise(() =>
          d1.prepare('SELECT enabled FROM u1_grant').first<{ enabled: number }>(),
        )

        if (enabled?.enabled !== 1 || scopes.join() !== 'catalogue:write') {
          return yield* new McpToolError({ code: 'access_denied', message: 'Fixture denied.' })
        }

        return {
          actorId: 'editor',
          clientId: 'client',
          resource: 'https://u1.example.test/mcp',
          // OR is intentional: missing parentheses would bypass the parent CAS/fence.
          liveGuard: sql`EXISTS (SELECT 1 FROM u1_grant WHERE enabled=1) OR 0`,
        }
      }),
  })

  const layer = Layer.mergeAll(db, authority, McpOperationStoreLayer(d1))

  const apply = (command: Schema.Json) =>
    Effect.runPromise(withTestLayer(applyMusicLink(command, Date.now()), layer))

  return { ...resource, d1, apply, layer }
}

const attach = (
  expectedRevision: number,
  platform = 'spotify',
  url = 'https://open.spotify.com/track/u1fixture',
) => ({
  entityType: 'track',
  entityId: 't',
  requestId: crypto.randomUUID(),
  expectedRevision,
  change: { operation: 'attach_music_link', platform, url },
})

test('manual link receipts atomically claim sources, replay original revisions, reject and explicitly remove', async () => {
  const f = await fixture()

  try {
    const command = attach(0)
    const applied = await f.apply(command)
    expect(applied).toMatchObject({ status: 'applied', outcome: { revision: { revision: 1 } } })

    const identity = await f.d1
      .prepare('SELECT state,entity_id,owner_token,lease_expires_at FROM music_source_identities')
      .first()

    expect(identity).toEqual({
      state: 'resolved',
      entity_id: 't',
      owner_token: null,
      lease_expires_at: null,
    })

    const link = await f.d1
      .prepare('SELECT id,status FROM music_entity_links')
      .first<{ id: string; status: string }>()

    expect(link?.status).toBe('verified')

    const reject = {
      ...command,
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      change: { operation: 'reject_music_link', linkId: link?.id ?? '' },
    }

    expect(await f.apply(reject)).toHaveProperty('status', 'applied')
    expect(await f.d1.prepare('SELECT status FROM music_entity_links').first()).toEqual({
      status: 'rejected',
    })
    expect(await f.d1.prepare('SELECT COUNT(*) AS n FROM music_source_identities').first()).toEqual(
      { n: 0 },
    )
    expect(await f.d1.prepare('SELECT COUNT(*) AS n FROM music_source_aliases').first()).toEqual({
      n: 0,
    })
    expect(await f.apply(attach(2))).toHaveProperty('status', 'conflict')
    expect(await f.apply(command)).toMatchObject({
      status: 'replayed',
      outcome: { revision: { revision: 1 } },
    })
    expect(await f.apply({ ...command, expectedRevision: 2 })).toHaveProperty('status', 'conflict')

    expect(
      await f.apply({
        ...reject,
        requestId: crypto.randomUUID(),
        expectedRevision: 2,
        change: { operation: 'remove_music_link', linkId: link?.id ?? '' },
      }),
    ).toHaveProperty('status', 'applied')
    expect(await f.apply(attach(3))).toHaveProperty('status', 'applied')
    expect(
      await f.d1.prepare('SELECT revision FROM music_tracks WHERE id=?').bind('t').first(),
    ).toEqual({ revision: 4 })
    await f.d1.prepare('UPDATE u1_grant SET enabled=0').run()
    await expect(f.apply(command)).rejects.toMatchObject({ code: 'access_denied' })
  } finally {
    await f.dispose()
  }
})

test('stale revisions, ownership, live leases and alias collisions leave no partial writes or receipts', async () => {
  const f = await fixture()

  try {
    const source = await Effect.runPromise(
      parseMusicSource('https://open.spotify.com/track/u1fixture', 'track'),
    )

    await f.d1
      .prepare(`INSERT INTO music_source_identities
      (source_key,platform,source_entity_type,external_id,canonical_url,state,owner_token,lease_expires_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'resolving','foreign',?,1,1)`)
      .bind(
        source.sourceKey,
        source.platform,
        source.sourceEntityType,
        source.externalId,
        source.canonicalUrl,
        Date.now() + 60000,
      )
      .run()
    expect(await f.apply(attach(0))).toHaveProperty('status', 'conflict')
    expect(
      await f.d1.prepare('SELECT revision FROM music_tracks WHERE id=?').bind('t').first(),
    ).toEqual({ revision: 0 })
    expect(await f.d1.prepare('SELECT COUNT(*) AS n FROM mcp_operations').first()).toEqual({ n: 0 })
    await f.d1.prepare('UPDATE music_source_identities SET lease_expires_at=0').run()
    expect(await f.apply(attach(0))).toHaveProperty('status', 'applied')
    expect(await f.apply({ ...attach(0), entityId: 'other' })).toHaveProperty('status', 'conflict')
    expect(await f.apply(attach(0, 'website', 'https://example.test/link'))).toHaveProperty(
      'status',
      'conflict',
    )

    const second = await Effect.runPromise(parseMusicSource('https://example.test/link', 'track'))
    await f.d1
      .prepare(
        `INSERT INTO music_source_aliases (normalized_url,source_key,first_seen_at,last_seen_at) VALUES (?,?,1,1)`,
      )
      .bind(second.normalizedUrl, source.sourceKey)
      .run()
    expect(await f.apply(attach(1, 'website', second.canonicalUrl))).toHaveProperty(
      'status',
      'conflict',
    )
    expect(await f.d1.prepare('SELECT COUNT(*) AS n FROM music_entity_links').first()).toEqual({
      n: 1,
    })
    expect(await f.d1.prepare('SELECT COUNT(*) AS n FROM mcp_operations').first()).toEqual({ n: 1 })
    expect(
      await f.apply(attach(1, 'spotify', 'https://open.spotify.com/track/replace')),
    ).toHaveProperty('status', 'conflict')
    await expect(f.apply(attach(1, 'deezer'))).rejects.toMatchObject({ code: 'invalid_input' })
  } finally {
    await f.dispose()
  }
})

test('shared source ownership survives removal of one display link', async () => {
  const f = await fixture()

  try {
    expect(
      await f.apply(attach(0, 'youtube', 'https://www.youtube.com/watch?v=abcdefghijk')),
    ).toHaveProperty('status', 'applied')
    expect(
      await f.apply(attach(1, 'youtube_music', 'https://www.youtube.com/watch?v=abcdefghijk')),
    ).toHaveProperty('status', 'applied')

    const link = await f.d1
      .prepare("SELECT id FROM music_entity_links WHERE platform='youtube_music'")
      .first<{ id: string }>()

    expect(
      await f.apply({
        entityType: 'track',
        entityId: 't',
        requestId: crypto.randomUUID(),
        expectedRevision: 2,
        change: { operation: 'remove_music_link', linkId: link?.id ?? '' },
      }),
    ).toHaveProperty('status', 'applied')
    expect(await f.d1.prepare('SELECT COUNT(*) AS n FROM music_source_identities').first()).toEqual(
      { n: 1 },
    )
    expect(await f.d1.prepare('SELECT platform,status FROM music_entity_links').first()).toEqual({
      platform: 'youtube',
      status: 'verified',
    })

    // A bad stored match can be removed without stealing/deleting its actual owner's source.
    await f.d1.prepare("UPDATE music_source_identities SET entity_id='other'").run()

    const remaining = await f.d1
      .prepare('SELECT id FROM music_entity_links')
      .first<{ id: string }>()

    expect(
      await f.apply({
        entityType: 'track',
        entityId: 't',
        requestId: crypto.randomUUID(),
        expectedRevision: 3,
        change: { operation: 'remove_music_link', linkId: remaining?.id ?? '' },
      }),
    ).toHaveProperty('status', 'applied')
    expect(await f.d1.prepare('SELECT entity_id FROM music_source_identities').first()).toEqual({
      entity_id: 'other',
    })

    await f.d1
      .prepare(`INSERT INTO music_entity_links
      (id,entity_type,entityId,platform,url,status,createdAt,updatedAt)
      VALUES ('unsafe','track','t','website','http://127.0.0.1/private','verified',1,1)`)
      .run()

    for (const [operation, expectedRevision] of [
      ['reject_music_link', 4],
      ['remove_music_link', 5],
    ] as const) {
      expect(
        await f.apply({
          entityType: 'track',
          entityId: 't',
          requestId: crypto.randomUUID(),
          expectedRevision,
          change: { operation, linkId: 'unsafe' },
        }),
      ).toHaveProperty('status', 'applied')
    }

    expect(await f.d1.prepare('SELECT COUNT(*) AS n FROM music_entity_links').first()).toEqual({
      n: 0,
    })
    expect(await f.d1.prepare('SELECT entity_id FROM music_source_identities').first()).toEqual({
      entity_id: 'other',
    })
  } finally {
    await f.dispose()
  }
})

test('opaque false guards, stale CAS and loss of authority or physical winner roll back the whole plan', async () => {
  const f = await fixture()

  const source = await Effect.runPromise(
    parseMusicSource('https://open.spotify.com/track/u1fixture', 'track'),
  )

  const store = createMcpOperationStore(f.d1)
  const target = { entityType: 'track', entityId: 't' } as const

  try {
    for (const scenario of ['false-authority', 'false-fence', 'stale', 'revoked', 'lost-winner']) {
      const result = await store.execute({
        key: {
          actorId: 'editor',
          clientId: 'client',
          resource: 'https://u1.example.test/mcp',
          operation: 'attach_music_link',
          requestId: crypto.randomUUID(),
        },
        normalizedInput: { scenario },
        now: Date.now(),
        authorize: async () => true,
        build: (context) => {
          const plan = musicLinkStatements({
            context: {
              ...context,
              fence: scenario === 'false-fence' ? sql`0 OR 0` : context.fence,
            },
            target,
            expectedRevision: scenario === 'stale' ? 1 : 0,
            liveGuard:
              scenario === 'false-authority'
                ? sql`0 OR 0`
                : sql`EXISTS (SELECT 1 FROM u1_grant WHERE enabled=1) OR 0`,
            now: Date.now(),
            observed: [],
            attach: [{ platform: 'spotify', url: source.canonicalUrl, source }],
            release: undefined,
          })

          const interleaving: Array<ReturnType<typeof context.prepare>> = []

          if (scenario === 'revoked')
            interleaving.push(f.d1.prepare('UPDATE u1_grant SET enabled=0'))

          if (scenario === 'lost-winner') {
            interleaving.push(
              f.d1
                .prepare("UPDATE music_tracks SET last_operation_id=? WHERE id='t'")
                .bind(crypto.randomUUID()),
            )
          }

          return {
            statements: [
              ...plan.statements.slice(0, 1),
              ...interleaving,
              ...plan.statements.slice(1),
            ],
            assertApplied: plan.assertApplied,
            outcome: { result: target, revision: 1, access: target },
          }
        },
      })

      expect({ scenario, status: result.status }).toEqual({ scenario, status: 'conflict' })
      expect(
        await f.d1
          .prepare('SELECT revision,last_operation_id FROM music_tracks WHERE id=?')
          .bind('t')
          .first(),
      ).toEqual({ revision: 0, last_operation_id: null })

      for (const table of [
        'mcp_operations',
        'music_entity_links',
        'music_source_identities',
        'music_source_aliases',
      ]) {
        expect(await f.d1.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).toEqual({ n: 0 })
      }
    }
  } finally {
    await f.dispose()
  }
})

test('actual MCP wire publishes object schemas and applies/replays/rejects/removes with live command authority', async () => {
  const f = await fixture()

  const app = HttpRouter.toWebHandler(
    makeMcpLayer([], LinkEditToolkit).pipe(
      Layer.provide(LinkEditHandlersLayer),
      Layer.provide(f.layer),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  )

  const rpc = async (method: string, params: { name?: string; arguments?: Schema.Json }) => {
    const headers = new Headers({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
    })

    if (params.name) headers.set('mcp-name', params.name)

    const response = await app.handler(
      new Request('https://u1.example.test/mcp', {
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

    const body = await response.text()
    expect(new TextEncoder().encode(body).length).toBeLessThan(262144)

    const data =
      body.startsWith('event:') || body.startsWith('data:')
        ? body
            .split('\n')
            .find((line) => line.startsWith('data:'))
            ?.slice(5)
        : body

    if (!data) throw new Error('Missing wire response')

    return Schema.decodeUnknownSync(Schema.Struct({ result: Schema.Unknown }))(JSON.parse(data))
      .result
  }

  const call = async (name: string, args: Schema.Json) => {
    const wire = await rpc('tools/call', { name, arguments: args })

    const structured = Schema.decodeUnknownSync(
      Schema.Struct({ structuredContent: Schema.Unknown }),
    )(wire)

    return Schema.decodeUnknownSync(LinkEditResult)(structured.structuredContent).result
  }

  try {
    const listed = Schema.decodeUnknownSync(
      Schema.Struct({
        tools: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            outputSchema: Schema.Struct({ type: Schema.Literal('object') }),
          }),
        ),
      }),
    )(await rpc('tools/list', {}))

    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      'attach_music_link',
      'reject_music_link',
      'remove_music_link',
    ])

    const input = {
      entityType: 'track',
      entityId: 't',
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      platform: 'spotify',
      url: 'https://open.spotify.com/track/u1wire',
    }

    expect(await call('attach_music_link', input)).toHaveProperty('status', 'applied')
    expect(await call('attach_music_link', input)).toHaveProperty('status', 'replayed')
    const link = await f.d1.prepare('SELECT id FROM music_entity_links').first<{ id: string }>()

    const release = {
      entityType: 'track',
      entityId: 't',
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      linkId: link?.id ?? '',
    }

    expect(await call('reject_music_link', release)).toHaveProperty('status', 'applied')
    expect(
      await call('remove_music_link', {
        ...release,
        requestId: crypto.randomUUID(),
        expectedRevision: 2,
      }),
    ).toHaveProperty('status', 'applied')
    await f.d1.prepare('UPDATE u1_grant SET enabled=0').run()

    for (const name of ['attach_music_link', 'reject_music_link', 'remove_music_link']) {
      const denied = Schema.decodeUnknownSync(Schema.Struct({ isError: Schema.Boolean }))(
        await rpc('tools/call', {
          name,
          arguments: name === 'attach_music_link' ? input : release,
        }),
      )

      expect(denied.isError).toBe(true)
    }
  } finally {
    await app.dispose()
    await f.dispose()
  }
})

test('all manual commands compile and commit dense16-platform observations under real persisted session and OAuth authority', async () => {
  await using f = await createEditorialOAuthFixture()
  await seedMusicLookups(f.db)
  await f.database.prepare("UPDATE user SET role='admin' WHERE id='owner'").run()
  const clientId = await f.register('catalogue:write')
  // Disposable local resource only; never production policy or a shared fixture change.
  await f.database
    .prepare('UPDATE oauth_resource SET allowed_scopes=?')
    .bind(JSON.stringify(['catalogue:write']))
    .run()

  const tokens = Schema.decodeUnknownSync(
    Schema.Struct({ access_token: Schema.RedactedFromValue(Schema.String) }),
  )(
    await (
      await f.exchange(clientId, await f.authorize(clientId, 'owner', 'catalogue:write'))
    ).json(),
  )

  const principal = await Effect.runPromise(f.service.verify(tokens.access_token))

  const oauth = await Effect.runPromise(
    makeOAuthCommandAuthority(tokens.access_token, principal).pipe(
      Effect.provideService(Database, f.db),
      Effect.provideService(ConfigService, f.config),
      Effect.provideService(EditorialOAuth, f.service),
    ),
  )

  const browser = await Effect.runPromise(
    makeSessionCommandAuthority.pipe(
      Effect.provideService(AuthSession, {
        user: { id: 'owner', name: 'owner', email: 'owner@example.com' },
        session: { id: 'owner-session', createdAt: new Date() },
      }),
      Effect.provideService(Database, f.db),
      Effect.provideService(ConfigService, f.config),
    ),
  )

  for (const [entityId, authority] of [
    ['browser', browser],
    ['oauth', oauth],
  ] as const) {
    await f.database
      .prepare('INSERT INTO music_tracks (id,title,slug,createdAt,updatedAt) VALUES (?,?,?,1,1)')
      .bind(entityId, entityId, entityId)
      .run()

    const observed = MUSIC_PLATFORMS.map((platform) => ({
      id: `${entityId}-${platform}`,
      platform,
      url: `https://example.test/${platform}`,
      status: 'verified',
    }))

    await f.database.batch(
      observed.map((link) =>
        f.database
          .prepare(`INSERT INTO music_entity_links
      (id,entity_type,entityId,platform,url,status,createdAt,updatedAt) VALUES (?,'track',?,?,?,'verified',1,1)`)
          .bind(link.id, entityId, link.platform, link.url),
      ),
    )

    const source = await Effect.runPromise(
      parseMusicSource('https://example.test/website', 'track'),
    )

    // Exercise the real receipt context, including its current fence/assert contract.
    // D1 itself rejects any statement exceeding its 100-binding limit.
    const layer = Layer.mergeAll(
      DatabaseLayer(f.database),
      Layer.succeed(CommandAuthority, authority),
      McpOperationStoreLayer(f.database),
    )

    const apply = (raw: Schema.Json) =>
      Effect.runPromise(withTestLayer(applyMusicLink(raw, Date.now()), layer))

    const command = {
      entityType: 'track',
      entityId,
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      change: { operation: 'attach_music_link', platform: 'website', url: source.canonicalUrl },
    }

    expect(await apply(command)).toMatchObject({
      status: 'applied',
      outcome: { revision: { revision: 1 } },
    })
    expect(await apply(command)).toHaveProperty('status', 'replayed')
    expect(
      await apply({
        ...command,
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
        change: { operation: 'reject_music_link', linkId: `${entityId}-website` },
      }),
    ).toHaveProperty('status', 'applied')
    expect(
      await apply({
        ...command,
        requestId: crypto.randomUUID(),
        expectedRevision: 2,
        change: { operation: 'remove_music_link', linkId: `${entityId}-website` },
      }),
    ).toHaveProperty('status', 'applied')
    expect(
      await f.database
        .prepare('SELECT revision FROM music_tracks WHERE id=?')
        .bind(entityId)
        .first(),
    ).toEqual({ revision: 3 })
    expect(
      await f.database
        .prepare('SELECT COUNT(*) AS n FROM music_entity_links WHERE entityId=?')
        .bind(entityId)
        .first(),
    ).toEqual({ n: 15 })
  }
}, 30_000)

test('JSON snapshot equality rejects same-count changes in every observed field as well as missing and extra rows', async () => {
  const f = await fixture()
  const target = { entityType: 'track', entityId: 't' } as const
  const store = createMcpOperationStore(f.d1)

  const original = {
    id: 'observed',
    platform: 'website',
    url: 'https://example.test/🧪?q="quoted"',
    status: 'verified',
  } as const

  try {
    for (const scenario of ['id', 'platform', 'url', 'status', 'missing', 'extra']) {
      await f.d1.prepare('DELETE FROM music_entity_links').run()
      await f.d1
        .prepare(`INSERT INTO music_entity_links (id,entity_type,entityId,platform,url,status,createdAt,updatedAt)
        VALUES (?,'track','t',?,?,?,1,1)`)
        .bind(original.id, original.platform, original.url, original.status)
        .run()

      if (scenario === 'id')
        await f.d1.prepare("UPDATE music_entity_links SET id='different'").run()

      if (scenario === 'platform')
        await f.d1.prepare("UPDATE music_entity_links SET platform='other'").run()

      if (scenario === 'url')
        await f.d1
          .prepare("UPDATE music_entity_links SET url='https://example.test/different'")
          .run()

      if (scenario === 'status')
        await f.d1.prepare("UPDATE music_entity_links SET status='rejected'").run()

      if (scenario === 'missing') await f.d1.prepare('DELETE FROM music_entity_links').run()

      if (scenario === 'extra')
        await f.d1
          .prepare(`INSERT INTO music_entity_links (id,entity_type,entityId,platform,url,status,createdAt,updatedAt)
        VALUES ('extra','track','t','other','https://example.test/extra','verified',1,1)`)
          .run()
      expect(
        await store.execute({
          key: {
            actorId: 'editor',
            clientId: 'client',
            resource: 'https://u1.example.test/mcp',
            operation: 'fixture',
            requestId: crypto.randomUUID(),
          },
          normalizedInput: { scenario },
          now: Date.now(),
          authorize: async () => true,
          build: (context) => ({
            ...musicLinkStatements({
              context,
              target,
              expectedRevision: 0,
              liveGuard: sql`1`,
              now: Date.now(),
              observed: [original],
              attach: [],
              release: undefined,
            }),
            outcome: { result: target, revision: 1, access: target },
          }),
        }),
      ).toHaveProperty('status', 'conflict')
      expect(await f.d1.prepare("SELECT revision FROM music_tracks WHERE id='t'").first()).toEqual({
        revision: 0,
      })
    }
  } finally {
    await f.dispose()
  }
})
