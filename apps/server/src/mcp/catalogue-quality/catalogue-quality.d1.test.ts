import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import {
  musicArtistsTable,
  musicAlbumsTable,
  musicTracksTable,
  musicLabelsTable,
  musicSourceIdentitiesTable,
  musicSourceIdentityConflictsTable,
} from '@/db/music-entity.schema'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { McpActor } from '../authorization'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { makeMcpLayer } from '../server'
import {
  CompareEntriesResult,
  ConflictResult,
  DuplicateResult,
  IncompleteResult,
  QualitySummaryResult,
} from './contracts'
import { CatalogueQualityService, CatalogueQualityServiceLayer } from './service'
import { CatalogueQualityHandlersLayer, CatalogueQualityToolkit } from './toolkit'

const actor = Schema.decodeUnknownSync(McpPrincipal)({
  userId: 'q1-admin',
  clientId: 'q1-client',
  scopes: ['catalogue:inspect'],
})

const config = Layer.succeed(
  EditorialMcpConfig,
  Schema.decodeUnknownSync(EditorialMcpSettings)({
    readScope: 'posts:read',
    environment: 'disposable-q1',
    resourceUrl: 'https://api.example.test/mcp',
    frontendUrl: 'https://example.test',
  }),
)

const serviceLayer = CatalogueQualityServiceLayer.pipe(
  Layer.provide(DatabaseTestLayer),
  Layer.provide(config),
)

const app = HttpRouter.toWebHandler(
  makeMcpLayer([], CatalogueQualityToolkit).pipe(
    Layer.provide(CatalogueQualityHandlersLayer),
    Layer.provide(serviceLayer),
    Layer.provide(HttpServer.layerServices),
  ),
  {
    disableLogger: true,
    middleware: (effect) => effect.pipe(Effect.provideService(McpActor, actor)),
  },
)

afterAll(() => app.dispose())

const rpc = async (method: string, name?: string, args: Schema.Json = {}) => {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
  })

  if (name) headers.set('mcp-name', name)

  const body = await (
    await app.handler(
      new Request('https://api.example.test/mcp', {
        method: 'POST',
        headers,
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
  ).text()

  expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(262144)

  const data =
    body.startsWith('event:') || body.startsWith('data:')
      ? body
          .split('\n')
          .find((s) => s.startsWith('data:'))
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
  )(await rpc('tools/call', name, args))

  expect(result.isError).not.toBe(true)

  return Schema.decodeUnknownSync(schema)(result.structuredContent)
}

const a = { entityType: 'artist', entityId: 'q1-a' } as const

const b = { entityType: 'artist', entityId: 'q1-b' } as const

beforeAll(async () => {
  await seedMusicLookups(db)
  await db
    .insert(user)
    .values({ id: actor.userId, name: 'Admin', email: 'q1@example.test', role: 'admin' })
  await db.insert(musicArtistsTable).values([
    {
      id: 'q1-a',
      name: 'Same',
      slug: 'q1-a',
      bio: 'Complete',
      imageUrl: 'https://example.test/art.jpg',
    },
    { id: 'q1-b', name: 'sAME', slug: 'q1-b', publishedAt: new Date('2099-01-01') },
    { id: 'q1-c', name: 'Same live', slug: 'q1-c' },
    { id: 'q1-d', name: 'Écho', slug: 'q1-d' },
    { id: 'q1-e', name: 'écho', slug: 'q1-e' },
  ])
  await db.insert(musicAlbumsTable).values({ id: 'q1-album', title: 'Same', slug: 'q1-album' })
  await db.insert(musicTracksTable).values({ id: 'q1-track', title: 'Song', slug: 'q1-track' })
  await db.insert(musicLabelsTable).values({
    id: 'q1-label',
    name: 'Label',
    slug: 'q1-label',
    content: 'PRIVATE LABEL BODY',
    description: null,
  })
  await db.insert(musicSourceIdentitiesTable).values([
    {
      sourceKey: 'spotify:artist:aaa',
      platform: 'spotify',
      sourceEntityType: 'artist',
      externalId: 'aaa',
      canonicalUrl: 'https://open.spotify.com/artist/aaa',
      state: 'resolving',
      ownerToken: 'SECRET OWNER',
      leaseExpiresAt: new Date('2099-01-01'),
    },
    {
      sourceKey: 'spotify:artist:bbb',
      platform: 'spotify',
      sourceEntityType: 'artist',
      externalId: 'bbb',
      canonicalUrl: 'https://open.spotify.com/artist/bbb',
      state: 'resolving',
      ownerToken: 'SECRET EXPIRED',
      leaseExpiresAt: new Date(1),
    },
  ])
  await db.insert(musicSourceIdentityConflictsTable).values([
    {
      id: 'q1-conflict-a',
      sourceKey: 'spotify:artist:aaa',
      incumbentEntityType: 'playlist',
      incumbentEntityId: 'PRIVATE PLAYLIST',
      candidateEntityType: 'artist',
      candidateEntityId: a.entityId,
      reason: 'SECRET REASON',
      detectedAt: new Date(100),
    },
    {
      id: 'q1-conflict-b',
      sourceKey: 'spotify:artist:aaa',
      incumbentEntityType: 'artist',
      incumbentEntityId: a.entityId,
      candidateEntityType: 'artist',
      candidateEntityId: b.entityId,
      reason: 'SECRET REASON',
      detectedAt: new Date(100),
    },
    {
      id: 'q1-conflict-closed',
      sourceKey: 'spotify:artist:bbb',
      incumbentEntityType: 'artist',
      incumbentEntityId: a.entityId,
      candidateEntityType: 'artist',
      candidateEntityId: b.entityId,
      reason: 'SECRET CLOSED',
      status: 'resolved',
      detectedAt: new Date(100),
    },
  ])
})

test('all five tools have object roots; exact name duplicates are hypotheses with ASCII folding only', async () => {
  const discovery = Schema.decodeUnknownSync(
    Schema.Struct({
      tools: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          outputSchema: Schema.Struct({ type: Schema.Literal('object') }),
        }),
      ),
    }),
  )(await rpc('tools/list'))

  expect(discovery.tools.map((t) => t.name).sort()).toEqual([
    'compare_music_entries',
    'find_duplicate_candidates',
    'find_incomplete_entries',
    'get_catalogue_quality_summary',
    'list_music_identity_conflicts',
  ])
  const result = await call('find_duplicate_candidates', { ...a, limit: 1 }, DuplicateResult)
  expect(result.candidates.map((c) => c.entityId)).toEqual(['q1-b'])
  expect(result.evidence).toContain('hypothesis_only')
  expect(
    (
      await call(
        'find_duplicate_candidates',
        { entityType: 'artist', entityId: 'q1-d' },
        DuplicateResult,
      )
    ).candidates,
  ).toEqual([])

  const comparison = await call(
    'compare_music_entries',
    { left: a, right: b },
    CompareEntriesResult,
  )

  expect(comparison).toMatchObject({
    sameCatalogueReference: false,
    sameKind: true,
    sameCasefoldedName: true,
    verdict: 'no_musical_equivalence_or_merge_verdict',
  })
  expect(
    await call(
      'compare_music_entries',
      { left: a, right: { entityType: 'album', entityId: 'q1-album' } },
      CompareEntriesResult,
    ),
  ).toMatchObject({ sameKind: false, sameCasefoldedName: true, sameCatalogueReference: false })
})

test('missing rules and examined-row cursors cover all four kinds without private bodies', async () => {
  const first = await call(
    'find_incomplete_entries',
    { entityType: 'artist', limit: 1 },
    IncompleteResult,
  )

  expect(first).toMatchObject({ scanned: 1, entries: [], nextAfterId: 'q1-a' })
  expect(
    (
      await call(
        'find_incomplete_entries',
        { entityType: 'artist', afterId: 'q1-a', limit: 1 },
        IncompleteResult,
      )
    ).entries[0]?.missingFields,
  ).toEqual(['artwork', 'description'])

  for (const [entityType, expected] of [
    ['album', ['artwork', 'release_date', 'artist_credit']],
    ['track', ['artwork', 'album', 'artist_credit']],
    ['label', ['artwork', 'description']],
  ] as const) {
    const result = await call('find_incomplete_entries', { entityType }, IncompleteResult)
    expect(result.entries[0]?.missingFields).toEqual(expected)
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|content|creatorId/)
  }
})

test('conflict tuple cursor advances past skipped kinds and preserves ties without source/reason dumps', async () => {
  const first = await call('list_music_identity_conflicts', { limit: 1 }, ConflictResult)
  expect(first).toMatchObject({
    conflicts: [],
    scanned: 1,
    nextAfter: { detectedAt: 100, id: 'q1-conflict-a' },
  })

  const next = await call(
    'list_music_identity_conflicts',
    { limit: 1, after: first.nextAfter },
    ConflictResult,
  )

  expect(next.conflicts.map((c) => c.conflictId)).toEqual(['q1-conflict-b'])
  expect(next.nextAfter).toBeNull()
  expect(JSON.stringify(next)).not.toMatch(/SECRET|PRIVATE|sourceKey|reason|ownerToken/)
})

test('summary counts only examined windows and reuses audit cursors without lease owners', async () => {
  const first = await call(
    'get_catalogue_quality_summary',
    { entityType: 'artist', limit: 1 },
    QualitySummaryResult,
  )

  expect(first).toMatchObject({
    scope: 'examined_windows_only_not_catalogue_totals',
    catalogue: { scanned: 1, incomplete: 0, nextAfterId: 'q1-a' },
    resolvingIdentities: {
      scanned: 1,
      active: 1,
      expired: 0,
      complete: false,
      nextSourceKey: 'spotify:artist:aaa',
    },
  })

  const next = await call(
    'get_catalogue_quality_summary',
    { entityType: 'artist', limit: 1, afterId: 'q1-a', afterSourceKey: 'spotify:artist:aaa' },
    QualitySummaryResult,
  )

  expect(next.resolvingIdentities).toMatchObject({
    scanned: 1,
    active: 0,
    expired: 1,
    complete: false,
  })

  const eof = await call(
    'get_catalogue_quality_summary',
    { entityType: 'artist', limit: 1, afterSourceKey: 'spotify:artist:bbb' },
    QualitySummaryResult,
  )

  expect(eof.resolvingIdentities).toMatchObject({ scanned: 0, complete: true, nextSourceKey: null })
  expect(JSON.stringify([first, next, eof])).not.toMatch(
    /SECRET|ownerToken|canonicalUrl|leaseExpiresAt|detail/,
  )
})

test('every service call enforces live admin and inspect scope, including downgrade and ban', async () => {
  const attempt = (principal: typeof McpPrincipal.Type) =>
    Effect.runPromise(
      withTestLayer(
        Effect.gen(function* () {
          const s = yield* CatalogueQualityService

          return yield* Effect.all([
            s.findDuplicateCandidates(a).pipe(Effect.result),
            s.compareMusicEntries({ left: a, right: b }).pipe(Effect.result),
            s.findIncompleteEntries({ entityType: 'artist' }).pipe(Effect.result),
            s.listMusicIdentityConflicts({}).pipe(Effect.result),
            s.getCatalogueQualitySummary({ entityType: 'artist' }).pipe(Effect.result),
          ])
        }).pipe(Effect.provideService(McpActor, principal)),
        serviceLayer,
      ),
    )

  for (const role of ['creator', 'user']) {
    await db.update(user).set({ role }).where(eq(user.id, actor.userId))

    for (const result of await attempt(actor))
      expect(result).toHaveProperty('failure.code', 'access_denied')
  }

  await db.update(user).set({ role: 'admin' }).where(eq(user.id, actor.userId))

  for (const result of await attempt(
    Schema.decodeUnknownSync(McpPrincipal)({ ...actor, scopes: ['catalogue:read'] }),
  ))
    expect(result).toHaveProperty('failure.code', 'access_denied')
  await db.update(user).set({ banned: true }).where(eq(user.id, actor.userId))

  try {
    expect(await rpc('tools/call', 'list_music_identity_conflicts', {})).toMatchObject({
      isError: true,
    })
  } finally {
    await db.update(user).set({ banned: false, role: 'admin' }).where(eq(user.id, actor.userId))
  }
})

test('all five HTTP reads leave every application table unchanged', async () => {
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
  await call('find_duplicate_candidates', a, DuplicateResult)
  await call('compare_music_entries', { left: a, right: b }, CompareEntriesResult)
  await call('find_incomplete_entries', { entityType: 'track' }, IncompleteResult)
  await call('list_music_identity_conflicts', {}, ConflictResult)
  await call('get_catalogue_quality_summary', { entityType: 'artist' }, QualitySummaryResult)
  expect(await snapshot()).toEqual(before)
})

test('display truncation never creates duplicate/equality evidence and oversized diagnostics fail explicitly', async () => {
  const prefix = '😀'.repeat(201)

  for (const [id, name] of [
    ['q1-long-a', prefix + 'A'],
    ['q1-long-b', prefix + 'B'],
  ] as const)
    await db.insert(musicArtistsTable).values({ id, name, slug: id })

  try {
    const left = { entityType: 'artist', entityId: 'q1-long-a' } as const
    const right = { entityType: 'artist', entityId: 'q1-long-b' } as const
    const compared = await call('compare_music_entries', { left, right }, CompareEntriesResult)
    expect(compared).toMatchObject({
      sameCasefoldedName: false,
      left: { nameTruncated: true },
      right: { nameTruncated: true },
    })
    expect(compared.left.name).toBe(compared.right.name)
    expect((await call('find_duplicate_candidates', left, DuplicateResult)).candidates).toEqual([])
  } finally {
    for (const id of ['q1-long-a', 'q1-long-b'])
      await db.delete(musicArtistsTable).where(eq(musicArtistsTable.id, id))
  }

  const conflictId = '😀'.repeat(40000)
  await db.insert(musicSourceIdentityConflictsTable).values({
    id: conflictId,
    sourceKey: 'spotify:artist:aaa',
    incumbentEntityType: 'artist',
    incumbentEntityId: b.entityId,
    candidateEntityType: 'artist',
    candidateEntityId: a.entityId,
    reason: 'PRIVATE',
    detectedAt: new Date(101),
  })

  try {
    expect(
      await rpc('tools/call', 'list_music_identity_conflicts', {
        after: { detectedAt: 100, id: 'q1-conflict-b' },
      }),
    ).toMatchObject({ isError: true })
  } finally {
    await db
      .delete(musicSourceIdentityConflictsTable)
      .where(eq(musicSourceIdentityConflictsTable.id, conflictId))
  }
})
