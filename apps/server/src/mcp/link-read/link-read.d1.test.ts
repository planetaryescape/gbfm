import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import {
  musicArtistsTable,
  musicEntityLinksTable,
  musicSourceIdentitiesTable,
} from '@/db/music-entity.schema'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { McpActor } from '../authorization'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { MusicReadServiceLayer } from '../music-read/service'
import { makeMcpLayer } from '../server'
import {
  CompareSourcesResult,
  EquivalentResult,
  HealthResult,
  LinksResult,
  MissingLinksResult,
} from './contracts'
import { LinkHealthUnavailable } from './health'
import { LinkReadService, LinkReadServiceLayer } from './service'
import { LinkReadHandlersLayer, LinkReadToolkit } from './toolkit'

const actor = Schema.decodeUnknownSync(McpPrincipal)({
  userId: 'r4-reader',
  clientId: 'r4-client',
  scopes: ['catalogue:read', 'providers:read'],
})

const config = Layer.succeed(
  EditorialMcpConfig,
  Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'disposable-r4',
    resourceUrl: 'https://api.example.test/mcp',
    frontendUrl: 'https://example.test',
  }),
)

const music = MusicReadServiceLayer.pipe(Layer.provide(DatabaseTestLayer), Layer.provide(config))

const services = LinkReadServiceLayer.pipe(
  Layer.provide(music),
  Layer.provide(DatabaseTestLayer),
  Layer.provide(LinkHealthUnavailable),
)

const makeApp = (principal: typeof McpPrincipal.Type) =>
  HttpRouter.toWebHandler(
    makeMcpLayer([], LinkReadToolkit).pipe(
      Layer.provide(LinkReadHandlersLayer),
      Layer.provide(services),
      Layer.provide(HttpServer.layerServices),
    ),
    {
      disableLogger: true,
      middleware: (effect) => effect.pipe(Effect.provideService(McpActor, principal)),
    },
  )

const app = makeApp(actor)

const readOnlyActor = Schema.decodeUnknownSync(McpPrincipal)({
  ...actor,
  scopes: ['catalogue:read'],
})

const readOnlyApp = makeApp(readOnlyActor)

afterAll(async () => {
  await app.dispose()
  await readOnlyApp.dispose()
})

const rpc = async (
  method: string,
  params: { readonly name?: string; readonly arguments?: Schema.Json } = {},
  target = app,
) => {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
  })

  if (params.name) headers.set('mcp-name', params.name)

  const response = await target.handler(
    new Request('https://api.example.test/mcp', {
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
  expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(262144)

  const data =
    body.startsWith('event:') || body.startsWith('data:')
      ? body
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
      : body

  if (!data) throw new Error('Missing MCP response')

  return Schema.decodeUnknownSync(Schema.Struct({ result: Schema.Unknown }))(JSON.parse(data))
    .result
}

const call = async <A>(name: string, args: Schema.Json, schema: Schema.Codec<A, unknown>) => {
  const result = Schema.decodeUnknownSync(
    Schema.Struct({
      structuredContent: Schema.optional(Schema.Unknown),
      isError: Schema.optional(Schema.Boolean),
    }),
  )(await rpc('tools/call', { name, arguments: args }))

  expect(result.isError).not.toBe(true)

  return Schema.decodeUnknownSync(schema)(result.structuredContent)
}

const ref = { entityType: 'artist', entityId: 'r4-a' } as const

beforeAll(async () => {
  await seedMusicLookups(db)
  await db
    .insert(user)
    .values({ id: actor.userId, name: 'Reader', email: 'r4@example.test', role: 'user' })
  await db.insert(musicArtistsTable).values([
    { id: 'r4-a', name: 'One', slug: 'r4-a', publishedAt: null },
    { id: 'r4-b', name: 'Two', slug: 'r4-b', publishedAt: new Date('2099-01-01') },
    { id: 'r4-c', name: 'Three', slug: 'r4-c' },
  ])
  await db.insert(musicEntityLinksTable).values([
    {
      id: 'r4-link-a',
      ...ref,
      platform: 'spotify',
      url: 'https://open.spotify.com/artist/abc?si=tracking',
      metadata: { secret: 'PRIVATE PROVENANCE' },
    },
    {
      id: 'r4-link-b',
      ...ref,
      platform: 'deezer',
      url: 'https://www.deezer.com/artist/123',
      status: 'rejected',
    },
    { id: 'r4-link-c', ...ref, platform: 'website', url: 'https://user:secret@localhost/' },
    {
      id: 'r4-link-d',
      entityType: 'artist',
      entityId: 'r4-b',
      platform: 'spotify',
      url: 'https://open.spotify.com/artist/def',
    },
  ])

  for (const [externalId, entityId] of [
    ['abc', 'r4-a'],
    ['def', 'r4-b'],
  ])
    await db.insert(musicSourceIdentitiesTable).values({
      sourceKey: `spotify:artist:${externalId}`,
      platform: 'spotify',
      sourceEntityType: 'artist',
      externalId,
      canonicalUrl: `https://open.spotify.com/artist/${externalId}`,
      state: 'resolved',
      entityType: 'artist',
      entityId,
      resolvedAt: new Date(1),
    })
})

test('discovery retains all five object-root read tools and health requires provider scope', async () => {
  const listed = Schema.decodeUnknownSync(
    Schema.Struct({
      tools: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          outputSchema: Schema.Struct({ type: Schema.Literal('object') }),
          annotations: Schema.Struct({ readOnlyHint: Schema.Literal(true) }),
        }),
      ),
    }),
  )(await rpc('tools/list'))

  expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
    'check_music_link_health',
    'compare_music_sources',
    'find_missing_platform_links',
    'find_platform_equivalent',
    'get_music_links',
  ])

  expect(
    await rpc(
      'tools/call',
      {
        name: 'check_music_link_health',
        arguments: { ...ref, platform: 'spotify' },
      },
      readOnlyApp,
    ),
  ).toMatchObject({ isError: true })

  const denied = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const service = yield* LinkReadService

        return yield* service
          .checkMusicLinkHealth({ ...ref, platform: 'spotify' })
          .pipe(Effect.result)
      }).pipe(Effect.provideService(McpActor, readOnlyActor)),
      services,
    ),
  )

  expect(denied).toHaveProperty('failure.code', 'access_denied')
})

test('safe link windows use scan cursors, skip rejected/unsafe evidence and preserve IDs', async () => {
  const first = await call('get_music_links', { ...ref, limit: 1 }, LinksResult)
  expect(first).toMatchObject({ scanned: 1, links: [], nextAfterPlatform: 'deezer' })

  const second = await call(
    'get_music_links',
    { ...ref, limit: 1, afterPlatform: 'deezer' },
    LinksResult,
  )

  expect(second.links).toEqual([
    {
      linkId: 'r4-link-a',
      platform: 'spotify',
      url: 'https://open.spotify.com/artist/abc',
      status: 'verified',
      verifiedAt: null,
      observedUpdatedAt: expect.any(String),
    },
  ])
  const last = await call('get_music_links', { ...ref, afterPlatform: 'spotify' }, LinksResult)
  expect(last.links).toEqual([])
  expect(last.nextAfterPlatform).toBeNull()
  expect(JSON.stringify([first, second, last])).not.toMatch(
    /PRIVATE|PROVENANCE|secret|metadata|verifiedBy/,
  )
})

test('equivalent/source comparison returns stored evidence, never HTTP musical equality', async () => {
  expect(
    (await call('find_platform_equivalent', { ...ref, platform: 'spotify' }, EquivalentResult))
      .result.status,
  ).toBe('stored_link')
  expect(
    (await call('find_platform_equivalent', { ...ref, platform: 'deezer' }, EquivalentResult))
      .result.status,
  ).toBe('insufficient_evidence')

  for (const [rightUrl, status] of [
    ['https://open.spotify.com/artist/abc?si=other', 'same_catalogue_entry'],
    ['https://open.spotify.com/artist/def', 'different_catalogue_entries'],
    ['https://open.spotify.com/artist/missing', 'insufficient_evidence'],
  ] as const)
    expect(
      (
        await call(
          'compare_music_sources',
          { leftUrl: 'https://open.spotify.com/artist/abc', rightUrl },
          CompareSourcesResult,
        )
      ).result.status,
    ).toBe(status)
})

test('missing-platform windows advance by scanned entity ID even when no entries are missing', async () => {
  const first = await call(
    'find_missing_platform_links',
    { entityType: 'artist', platform: 'spotify', limit: 2 },
    MissingLinksResult,
  )

  expect(first).toMatchObject({ scanned: 2, missing: [], nextAfterId: 'r4-b' })
  expect(
    await call(
      'find_missing_platform_links',
      { entityType: 'artist', platform: 'spotify', limit: 2, afterId: 'r4-b' },
      MissingLinksResult,
    ),
  ).toMatchObject({
    scanned: 1,
    missing: [{ entityType: 'artist', entityId: 'r4-c' }],
    nextAfterId: null,
  })
})

test('unconfigured egress reports provider unavailable and never rewrites any application table', async () => {
  const snapshot = async () => {
    const tables = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type='table' and name not like 'sqlite_%' and substr(name,1,4)<>'_cf_' order by name`,
    )

    return Promise.all(
      tables.map(async ({ name }) => [
        name,
        await db.all(sql`select * from ${sql.identifier(name)}`),
      ]),
    )
  }

  const before = await snapshot()

  const result = await call(
    'check_music_link_health',
    { ...ref, platform: 'spotify' },
    HealthResult,
  )

  expect(result).toMatchObject({
    observation: { status: 'provider_unavailable', reason: 'transport_unavailable' },
    evidence: 'http_availability_only',
  })
  await call('get_music_links', ref, LinksResult)
  await call('find_platform_equivalent', { ...ref, platform: 'deezer' }, EquivalentResult)
  await call(
    'find_missing_platform_links',
    { entityType: 'artist', platform: 'spotify' },
    MissingLinksResult,
  )
  await call(
    'compare_music_sources',
    {
      leftUrl: 'https://open.spotify.com/artist/abc',
      rightUrl: 'https://open.spotify.com/artist/missing',
    },
    CompareSourcesResult,
  )
  expect(await snapshot()).toEqual(before)
})

test('live banning is checked before read/probe work', async () => {
  await db.update(user).set({ banned: true }).where(eq(user.id, actor.userId))

  try {
    const result = Schema.decodeUnknownSync(
      Schema.Struct({
        isError: Schema.Boolean,
        content: Schema.Array(Schema.Struct({ text: Schema.String })),
      }),
    )(
      await rpc('tools/call', {
        name: 'check_music_link_health',
        arguments: { ...ref, platform: 'spotify' },
      }),
    )

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('access_denied')
  } finally {
    await db.update(user).set({ banned: false }).where(eq(user.id, actor.userId))
  }
})

test('oversize link IDs fail explicitly and typed provider mismatches are not equivalents', async () => {
  const id = '😀'.repeat(40000)
  await db.insert(musicEntityLinksTable).values({
    id,
    entityType: 'artist',
    entityId: 'r4-c',
    platform: 'spotify',
    url: 'https://open.spotify.com/artist/ghi',
  })

  try {
    expect(
      await rpc('tools/call', {
        name: 'get_music_links',
        arguments: { entityType: 'artist', entityId: 'r4-c' },
      }),
    ).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('smaller page') }],
    })
    await db
      .update(musicEntityLinksTable)
      .set({ url: 'https://open.spotify.com/track/ghi' })
      .where(eq(musicEntityLinksTable.id, id))
    expect(
      await call(
        'find_platform_equivalent',
        { entityType: 'artist', entityId: 'r4-c', platform: 'spotify' },
        EquivalentResult,
      ),
    ).toHaveProperty('result.status', 'insufficient_evidence')
  } finally {
    await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.id, id))
  }
})
