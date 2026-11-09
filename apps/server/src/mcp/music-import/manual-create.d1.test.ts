import { McpPrincipal, McpResourceUrl } from '@gbfm/core/editorial-mcp'
import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Result, Schema } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import {
  musicAlbumsTable,
  musicArtistsTable,
  musicLabelCreatorsTable,
  musicLabelsTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { oauthClient } from '@/db/oauth.schema'
import { entityLabelsTable } from '@/db/tags.schema'
import { McpActor, McpAuthorizationLive } from '@/mcp/authorization'
import { McpOperationStoreLayer } from '@/mcp/operations/store'
import { createLabelEffect } from '@/services/music-entity/label.service'
import { db } from '@/test/d1'
import { withTestLayer } from '@/test/effect'

import { MusicImportCommandsLayer } from './commands'
import { MusicImportExecutionAuthorityLayer, MusicImportLiveGrant } from './execution-authority'
import { MusicManualCreate, MusicManualCreateLayer } from './manual-create'

const now = 1_800_000_000_000

const resource = Schema.decodeUnknownSync(McpResourceUrl)('https://api.example.test/mcp')

const principal = Schema.decodeUnknownSync(McpPrincipal)({
  userId: 'manual-admin',
  clientId: 'manual-client',
  scopes: ['catalogue:write'],
})

const database = Layer.succeed(Database, db)

const authorization = McpAuthorizationLive.pipe(Layer.provide(database))

const authority = MusicImportExecutionAuthorityLayer.pipe(
  Layer.provide(MusicImportCommandsLayer.pipe(Layer.provide(authorization))),
  Layer.provide(authorization),
  Layer.provide(Layer.succeed(MusicImportLiveGrant, { reverify: () => Effect.succeed(principal) })),
  Layer.provide(Layer.succeed(McpActor, principal)),
)

const writer = MusicManualCreateLayer.pipe(
  Layer.provide(authority),
  Layer.provide(McpOperationStoreLayer(db.$client)),
  Layer.provide(database),
)

// Controlled authority guard, not production OAuth SQL. The production adapter
// is P1-owned and remains a separate composed integration prerequisite.
const liveGuard = sql`EXISTS (SELECT 1 FROM user WHERE id = ${principal.userId} AND role = 'admin' AND coalesce(banned,0) = 0)
  AND EXISTS (SELECT 1 FROM oauth_client WHERE client_id = ${principal.clientId} AND coalesce(disabled,0) = 0)`

const execute = (raw: Schema.Json, at = now, guard = liveGuard) =>
  Effect.runPromise(
    withTestLayer(
      Effect.flatMap(MusicManualCreate, (service) =>
        service.execute(raw, resource, { now: at, liveGuard: guard }),
      ),
      writer,
    ),
  )

const artist = (name: string) => ({
  operation: 'create_artist',
  input: {
    requestId: crypto.randomUUID(),
    name,
    slug: crypto.randomUUID(),
    genres: ['jazz', 'ambient', 'jazz'],
  },
})

beforeAll(async () => {
  await db
    .insert(user)
    .values({ id: principal.userId, name: 'Admin', email: 'manual@example.test', role: 'admin' })
  await db.insert(oauthClient).values({
    id: 'manual-client-row',
    clientId: principal.clientId,
    redirectUris: '[]',
    disabled: false,
  })
})

test('six concurrent manual creates and a lost-response retry replay one original created outcome', async () => {
  const command = artist('One original artist')
  const results = await Promise.all(Array.from({ length: 6 }, () => execute(command)))
  expect(results.filter((result) => result.status === 'applied')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'replayed')).toHaveLength(5)
  const [first] = results

  if (!first || !('outcome' in first)) throw new Error('Expected saved outcome')

  for (const result of results) expect(result).toMatchObject({ outcome: first.outcome })
  const replay = await execute(command)
  expect(replay).toMatchObject({ status: 'replayed', outcome: first.outcome })
  expect(first.outcome.result).toMatchObject({ status: 'created' })

  const rows = await db
    .select()
    .from(musicArtistsTable)
    .where(eq(musicArtistsTable.name, command.input.name))

  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ revision: 0, createdById: principal.userId })
  expect(
    await db
      .select()
      .from(entityLabelsTable)
      .where(eq(entityLabelsTable.entityId, rows[0]?.id ?? 'missing')),
  ).toHaveLength(2)
  expect(
    await execute({ ...command, input: { ...command.input, name: 'Changed payload' } }),
  ).toMatchObject({ status: 'conflict' })
})

test('receipt expiry never re-creates and revoked clients cannot disclose an original result', async () => {
  const command = artist('Retained expiry')
  expect(await execute(command)).toMatchObject({ status: 'applied' })
  await db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, principal.clientId))
  expect(await execute(command)).toMatchObject({ status: 'access_denied' })
  await db
    .update(oauthClient)
    .set({ disabled: false })
    .where(eq(oauthClient.clientId, principal.clientId))
  expect(await execute(command, now + 86_400_000)).toMatchObject({ status: 'expired' })
  expect(await execute(command, now + 86_400_001)).toMatchObject({ status: 'expired' })
  expect(
    await db.select().from(musicArtistsTable).where(eq(musicArtistsTable.name, command.input.name)),
  ).toHaveLength(1)
})

test('album and track creates atomically derive ordered credits instead of caller-supplied stale names', async () => {
  const artistIds = [crypto.randomUUID(), crypto.randomUUID()]
  await db
    .insert(musicArtistsTable)
    .values(artistIds.map((id, index) => ({ id, name: index === 0 ? 'Beta' : 'Alpha', slug: id })))

  const albumCommand = {
    operation: 'create_album',
    input: {
      requestId: crypto.randomUUID(),
      title: 'Ordered album',
      slug: crypto.randomUUID(),
      artistIds,
      artistNames: ['Wrong'],
      genres: ['jazz'],
    },
  }

  expect(await execute(albumCommand)).toMatchObject({ status: 'applied' })

  const [album] = await db
    .select()
    .from(musicAlbumsTable)
    .where(eq(musicAlbumsTable.slug, albumCommand.input.slug))

  expect(album).toMatchObject({ artistNames: ['Beta', 'Alpha'], revision: 0 })

  if (!album) throw new Error('Expected created album')
  expect(
    await execute({
      operation: 'create_track',
      input: {
        requestId: crypto.randomUUID(),
        title: 'Ordered track',
        slug: 'ordered-track',
        artistIds: [...artistIds].reverse(),
        albumId: album.id,
        trackNumber: 2,
      },
    }),
  ).toMatchObject({ status: 'applied' })

  const [track] = await db
    .select()
    .from(musicTracksTable)
    .where(eq(musicTracksTable.slug, 'ordered-track'))

  expect(track).toMatchObject({
    artistNames: ['Alpha', 'Beta'],
    revision: 0,
    trackNumber: 2,
    albumId: album?.id,
  })
})

test('MCP label creation is audit-only while the existing browser create retains creator authority', async () => {
  const label = {
    operation: 'create_label',
    input: {
      requestId: crypto.randomUUID(),
      name: 'Audit label',
      slug: 'audit-label',
      content: '',
      genres: ['jazz'],
      tags: ['independent'],
    },
  }

  expect(await execute(label)).toMatchObject({ status: 'applied' })

  const [row] = await db
    .select()
    .from(musicLabelsTable)
    .where(eq(musicLabelsTable.slug, 'audit-label'))

  expect(row).toMatchObject({ createdById: principal.userId, revision: 0 })
  expect(
    await db
      .select()
      .from(musicLabelCreatorsTable)
      .where(eq(musicLabelCreatorsTable.labelId, row?.id ?? 'missing')),
  ).toEqual([])

  const browser = await Effect.runPromise(
    createLabelEffect({
      name: 'Browser label',
      slug: 'browser-label',
      content: '',
      createdById: principal.userId,
      genres: ['jazz'],
    }).pipe(Effect.provideService(Database, db)),
  )

  expect(
    await db
      .select()
      .from(musicLabelCreatorsTable)
      .where(eq(musicLabelCreatorsTable.labelId, browser.id)),
  ).toEqual([{ labelId: browser.id, creatorId: principal.userId }])
  await db.update(user).set({ role: 'creator' }).where(eq(user.id, principal.userId))

  const denied = await Effect.runPromise(
    withTestLayer(
      Effect.flatMap(MusicManualCreate, (service) =>
        service.execute(label, resource, { now, liveGuard }),
      ),
      writer,
    ).pipe(Effect.result),
  )

  expect(Result.isFailure(denied)).toBe(true)
  expect(denied).toMatchObject({ failure: { code: 'access_denied' } })
  expect(
    await db
      .select()
      .from(musicLabelCreatorsTable)
      .where(eq(musicLabelCreatorsTable.labelId, row?.id ?? 'missing')),
  ).toEqual([])
  await db.update(user).set({ role: 'admin' }).where(eq(user.id, principal.userId))
})

test('a false live SQL guard and a coupled FK failure leave no entity, junctions or receipt', async () => {
  const guarded = artist('SQL denied')
  expect(await execute(guarded, now, sql`false`)).toMatchObject({ status: 'conflict' })
  expect(
    await db.select().from(musicArtistsTable).where(eq(musicArtistsTable.name, guarded.input.name)),
  ).toEqual([])

  const broken = {
    operation: 'create_album',
    input: {
      requestId: crypto.randomUUID(),
      title: 'Failed graph',
      slug: 'failed-graph',
      artistIds: ['missing-artist'],
      genres: ['must-not-commit'],
    },
  }

  expect(await execute(broken)).toMatchObject({ status: 'unavailable' })
  expect(
    await db.select().from(musicAlbumsTable).where(eq(musicAlbumsTable.slug, 'failed-graph')),
  ).toEqual([])
  expect(await db.get(sql`SELECT 1 FROM labels WHERE name = 'must-not-commit'`)).toBeUndefined()
  // Reusing the same request after repairing its missing dependency must work:
  // a failed atomic batch may not strand a pending receipt.
  await db
    .insert(musicArtistsTable)
    .values({ id: 'missing-artist', name: 'Now exists', slug: 'missing-artist' })
  expect(await execute(broken)).toMatchObject({ status: 'applied' })
})
