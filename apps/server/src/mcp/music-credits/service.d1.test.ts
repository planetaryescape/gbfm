import { AuthSession } from '@gbfm/api/middleware/auth'
import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Result, Schema } from 'effect'
import { expect, test } from 'vitest'

import { user } from '../../db/auth.schema'
import { Database } from '../../db/layer'
import { musicArtistAliasesTable, musicRecordingCreditsTable } from '../../db/music-credit.schema'
import { musicAlbumsTable, musicArtistsTable, musicTracksTable } from '../../db/music-entity.schema'
import { oauthClient, oauthResource } from '../../db/oauth.schema'
import { ConfigService } from '../../services/config.service'
import { EditorialOAuth } from '../../services/editorial-oauth.service'
import { createEditorialOAuthFixture, OAuthTokens } from '../../test/editorial-oauth'
import { withTestLayer } from '../../test/effect'
import { McpActor, type McpAuthorization, McpAuthorizationLive } from '../authorization'
import {
  CommandAuthority,
  makeOAuthCommandAuthority,
  makeSessionCommandAuthority,
} from '../command-authority'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { musicVersion, MusicVersion } from '../music-edit/version'
import { McpOperationStore, createMcpOperationStore } from '../operations/store'
import { makeMcpWireResponse } from '../wire-response'
import { SetArtistAliasesInput, SetRecordingCreditsInput } from './contract'
import type { MusicFactsWire } from './projection'
import { MusicFactsService, MusicFactsServiceLive } from './service'

const now = 1_800_000_000_000

const target = { type: 'track', id: 't' }

const evidence = { sourceLabel: 'Sleeve', evidenceNote: 'Page 2' }

// Explicit fixture IDs; the actual route supplies admitted IDs in production.
const fixtureWire = (id: string | number): MusicFactsWire => makeMcpWireResponse(id, 'json')

const wire = fixtureWire(1)

const fixture = async () => {
  const f = await createEditorialOAuthFixture()
  await f.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  await f.db.insert(musicArtistsTable).values([
    { id: 'a', name: 'Primary', slug: 'primary' },
    { id: 'b', name: 'Second', slug: 'second' },
  ])
  await f.db
    .insert(musicAlbumsTable)
    .values({ id: 'album', title: 'Album', slug: 'album', artistNames: ['Old billing'] })
  await f.db.insert(musicTracksTable).values({
    id: 't',
    title: 'Track',
    slug: 'track',
    albumId: 'album',
    artistNames: ['Old billing'],
  })

  const authority = await Effect.runPromise(
    makeSessionCommandAuthority.pipe(
      Effect.provideService(AuthSession, {
        user: { id: 'owner', name: 'Owner', email: 'owner@example.com' },
        session: { id: 'owner-session', createdAt: new Date() },
      }),
      Effect.provideService(Database, f.db),
      Effect.provideService(ConfigService, f.config),
    ),
  )

  const base = Layer.mergeAll(
    Layer.succeed(Database, f.db),
    Layer.succeed(McpOperationStore, createMcpOperationStore(f.database)),
    Layer.succeed(
      EditorialMcpConfig,
      Schema.decodeUnknownSync(EditorialMcpSettings)({
        readScope: 'posts:read',
        environment: 'disposable-m2',
        resourceUrl: f.config.mcp.resourceUrl,
        frontendUrl: f.config.urls.frontend,
      }),
    ),
  )

  const service = await Effect.runPromise(
    withTestLayer(MusicFactsService, MusicFactsServiceLive.pipe(Layer.provide(base))),
  )

  const principal = Schema.decodeUnknownSync(McpPrincipal)({
    userId: 'owner',
    clientId: 'fixture',
    scopes: ['catalogue:read', 'catalogue:write'],
  })

  const run = <A, E>(
    effect: Effect.Effect<A, E, CommandAuthority | McpAuthorization>,
    currentAuthority = authority,
  ) =>
    Effect.runPromise(
      withTestLayer(
        effect.pipe(Effect.provideService(CommandAuthority, currentAuthority)),
        McpAuthorizationLive.pipe(Layer.provide(base)),
      ).pipe(Effect.provideService(McpActor, principal)),
    )

  const creditsVersion = async () =>
    Schema.decodeUnknownSync(Schema.Struct({ expectedVersion: MusicVersion }))(
      await run(service.readRecordingCredits({ target, editable: true, limit: 50 }, wire)),
    ).expectedVersion

  const aliasesVersion = async () =>
    Schema.decodeUnknownSync(Schema.Struct({ expectedVersion: MusicVersion }))(
      await run(service.readArtistAliases({ artistId: 'a', editable: true, limit: 50 }, wire)),
    ).expectedVersion

  return { ...f, oauth: f.service, service, run, creditsVersion, aliasesVersion }
}

const code = <A, E extends { readonly code: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => 'ok' }))

const creditItem = Schema.decodeUnknownSync(SetRecordingCreditsInput.fields.credits.value)

test('real session authority + shared CAS/store: no-op is marker-only; replay survives clear and checks revocation', async () => {
  await using f = await fixture()

  const input = {
    requestId: crypto.randomUUID(),
    expectedVersion: await f.creditsVersion(),
    target,
    credits: [
      {
        artistId: 'a',
        creditedName: 'Primary',
        role: 'instrument',
        instrument: 'Bass',
        ...evidence,
      },
      {
        artistId: 'a',
        creditedName: 'Primary',
        role: 'instrument',
        instrument: 'Piano',
        ...evidence,
      },
      { creditedName: 'Unknown Engineer', role: 'engineer', ...evidence },
    ],
  }

  const first = await f.run(f.service.setRecordingCredits(input, now, wire))
  expect(first).toMatchObject({
    status: 'applied',
    changed: true,
    collection: {
      status: 'complete',
      items: [
        { instrument: 'Bass' },
        { instrument: 'Piano' },
        { creditedName: 'Unknown Engineer' },
      ],
    },
  })

  const before = await f.db
    .select()
    .from(musicRecordingCreditsTable)
    .orderBy(musicRecordingCreditsTable.displayOrder)

  const publicRead = await f.run(f.service.readRecordingCredits({ target }, wire))
  expect(publicRead).not.toHaveProperty('expectedVersion')
  expect(JSON.stringify(publicRead)).not.toMatch(/assertedById|assertedAt|createdAt|participantKey/)
  expect(publicRead).toMatchObject({
    status: 'complete',
    items: [{ artistId: 'a' }, { artistId: 'a' }, { creditedName: 'Unknown Engineer' }],
  })

  await f.database.exec(
    "CREATE TRIGGER no_delete_probe BEFORE DELETE ON music_recording_credits BEGIN SELECT RAISE(ABORT,'unexpected no-op DELETE'); END;",
  )

  if (first.collection.kind !== 'recording_credits') throw new Error('Expected credit collection')

  const noOpInput = {
    ...input,
    requestId: crypto.randomUUID(),
    expectedVersion: first.collection.expectedVersion,
    credits: first.collection.items.map((row) => creditItem(row)),
  }

  const noOp = await f.run(f.service.setRecordingCredits(noOpInput, now + 1, wire))
  expect(noOp.changed).toBe(false)
  expect(noOp.collection.expectedVersion).toBe(first.collection.expectedVersion)
  expect(
    await f.db
      .select()
      .from(musicRecordingCreditsTable)
      .orderBy(musicRecordingCreditsTable.displayOrder),
  ).toEqual(before)
  expect(
    await f.db.get(sql`SELECT revision,last_operation_id FROM music_tracks WHERE id='t'`),
  ).toMatchObject({ revision: 1, last_operation_id: expect.any(String) })
  expect(await f.db.get(sql`SELECT count(*) AS n FROM mcp_operations`)).toEqual({ n: 2 })
  await f.database.exec('DROP TRIGGER no_delete_probe;')
  await f.run(
    f.service.setRecordingCredits(
      { ...noOpInput, requestId: crypto.randomUUID(), credits: [] },
      now + 2,
      wire,
    ),
  )
  expect(await f.run(f.service.setRecordingCredits(input, now + 3, wire))).toEqual({
    ...first,
    status: 'replayed',
  })
  expect(await f.db.select().from(musicRecordingCreditsTable)).toEqual([])
  expect(
    await f.run(code(f.service.setRecordingCredits({ ...input, credits: [] }, now + 3, wire))),
  ).toBe('conflict')
  expect(await f.db.select().from(musicTracksTable)).toMatchObject([
    { revision: 2, artistNames: ['Old billing'], publishedAt: null },
  ])
  expect(await f.db.select().from(musicAlbumsTable)).toMatchObject([
    { revision: 0, artistNames: ['Old billing'] },
  ])
  await f.db.update(user).set({ banned: true }).where(eq(user.id, 'owner'))
  expect(await f.run(code(f.service.setRecordingCredits(input, now + 4, wire)))).toBe(
    'access_denied',
  )
  await f.db.update(user).set({ banned: false }).where(eq(user.id, 'owner'))
  expect(await f.run(code(f.service.setRecordingCredits(input, now + 86_400_000, wire)))).toBe(
    'expired',
  )
}, 15_000)

test('aliases are per artist, BINARY ordered, preserve evidence identity and invalidate on parent rename', async () => {
  await using f = await fixture()

  const initial = {
    requestId: crypto.randomUUID(),
    artistId: 'a',
    expectedVersion: await f.aliasesVersion(),
    aliases: [
      { name: '\u{10000}', ...evidence },
      { name: '\uE000', ...evidence },
      { name: 'Stage', ...evidence },
    ],
  }

  const first = await f.run(f.service.setArtistAliases(initial, now, wire))

  if (first.collection.kind !== 'artist_aliases') throw new Error('Expected alias collection')
  expect(first.collection.items.map((row) => row.name)).toEqual(['Stage', '\uE000', '\u{10000}'])

  const noOp = {
    ...initial,
    requestId: crypto.randomUUID(),
    expectedVersion: first.collection.expectedVersion,
    aliases: first.collection.items
      .map((row) => Schema.decodeUnknownSync(SetArtistAliasesInput.fields.aliases.value)(row))
      .toReversed(),
  }

  expect((await f.run(f.service.setArtistAliases(noOp, now + 1, wire))).changed).toBe(false)
  expect(
    await f.run(
      code(
        f.service.setArtistAliases(
          {
            ...noOp,
            requestId: crypto.randomUUID(),
            aliases: [{ name: ' PRIMARY ', ...evidence }],
          },
          now,
          wire,
        ),
      ),
    ),
  ).toBe('invalid_input')
  await f.db
    .update(musicArtistsTable)
    .set({ name: 'Renamed', revision: 2 })
    .where(eq(musicArtistsTable.id, 'a'))
  expect(
    await f.run(
      code(f.service.setArtistAliases({ ...noOp, requestId: crypto.randomUUID() }, now, wire)),
    ),
  ).toBe('conflict')
  expect(await f.run(f.service.setArtistAliases(initial, now + 2, wire))).toEqual({
    ...first,
    status: 'replayed',
  })

  const bVersion = await Effect.runPromise(
    musicVersion({ entityType: 'artist', entityId: 'b', revision: 0 }),
  )

  await f.run(
    f.service.setArtistAliases(
      { ...initial, artistId: 'b', expectedVersion: bVersion, requestId: crypto.randomUUID() },
      now,
      wire,
    ),
  )
  expect((await f.db.select().from(musicArtistAliasesTable)).length).toBe(6)
  await f.db.delete(musicArtistsTable).where(eq(musicArtistsTable.id, 'a'))
  expect((await f.db.select().from(musicArtistAliasesTable)).map((row) => row.artistId)).toEqual([
    'b',
    'b',
    'b',
  ])
  expect(await f.run(code(f.service.setArtistAliases(initial, now, wire)))).toBe('access_denied')
}, 15_000)

test('fresh competing writes have one winner; invalid ownership and storage failure leave facts/revisions/receipts unchanged', async () => {
  await using f = await fixture()
  const version = await f.creditsVersion()

  const command = (name: string) => ({
    requestId: crypto.randomUUID(),
    expectedVersion: version,
    target,
    credits: [{ creditedName: name, role: 'performer', ...evidence }],
  })

  const results = await Promise.all(
    ['Left', 'Right'].map((name) =>
      f.run(Effect.result(f.service.setRecordingCredits(command(name), now, wire))),
    ),
  )

  expect(results.filter(Result.isSuccess)).toHaveLength(1)
  const failure = results.find(Result.isFailure)
  expect(failure?.failure.code).toBe('conflict')
  const rows = await f.db.select().from(musicRecordingCreditsTable)
  expect(rows).toHaveLength(1)
  const current = await f.creditsVersion()
  expect(
    await f.run(
      code(
        f.service.setRecordingCredits(
          {
            ...command('Foreign'),
            expectedVersion: current,
            credits: [
              { id: crypto.randomUUID(), creditedName: 'Foreign', role: 'performer', ...evidence },
            ],
          },
          now,
          wire,
        ),
      ),
    ),
  ).toBe('invalid_input')
  await f.database.exec(
    "CREATE TRIGGER facts_failure_probe BEFORE INSERT ON music_recording_credits BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;",
  )
  expect(
    await f.run(
      code(
        f.service.setRecordingCredits({ ...command('New'), expectedVersion: current }, now, wire),
      ),
    ),
  ).toBe('unavailable')
  expect(await f.db.select().from(musicRecordingCreditsTable)).toEqual(rows)
  expect(await f.db.get(sql`SELECT revision FROM music_tracks WHERE id='t'`)).toEqual({
    revision: 1,
  })
  expect(await f.db.get(sql`SELECT count(*) AS n FROM mcp_operations`)).toEqual({ n: 1 })
}, 15_000)

test('precommit outcome/wire budgets reject without writes; complete and partial projections differ', async () => {
  await using f = await fixture()
  const version = await f.creditsVersion()

  const oversized = {
    requestId: crypto.randomUUID(),
    expectedVersion: version,
    target,
    credits: Array.from({ length: 50 }, (_, i) => ({
      creditedName: `Player ${i}`,
      role: 'performer',
      sourceLabel: 'Sleeve',
      evidenceNote: 'é'.repeat(1000),
    })),
  }

  expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeLessThan(128 * 1024)
  expect(await f.run(code(f.service.setRecordingCredits(oversized, now, wire)))).toBe(
    'invalid_input',
  )
  expect(
    await f.run(
      code(
        f.service.setRecordingCredits(
          { ...oversized, credits: [] },
          now,
          fixtureWire('x'.repeat(256 * 1024)),
        ),
      ),
    ),
  ).toBe('invalid_input')
  expect(await f.db.get(sql`SELECT count(*) AS n FROM mcp_operations`)).toEqual({ n: 0 })
  expect(await f.db.get(sql`SELECT revision FROM music_tracks WHERE id='t'`)).toEqual({
    revision: 0,
  })

  const valid = {
    ...oversized,
    requestId: crypto.randomUUID(),
    credits: oversized.credits.map((row) => ({ ...row, evidenceNote: 'Page 2' })),
  }

  const saved = await f.run(f.service.setRecordingCredits(valid, now, wire))
  expect(saved.collection.items).toHaveLength(50)
  const partial = await f.run(f.service.readRecordingCredits({ target, editable: true }, wire))
  expect(partial).toMatchObject({ status: 'partial', pagination: { limit: 20, hasMore: true } })
  expect(partial).not.toHaveProperty('expectedVersion')

  const complete = await f.run(
    f.service.readRecordingCredits({ target, editable: true, limit: 50 }, wire),
  )

  expect(complete).toMatchObject({
    status: 'complete',
    expectedVersion: saved.collection.expectedVersion,
  })

  if (saved.collection.kind !== 'recording_credits') throw new Error('Expected credit collection')

  const noOpInput = {
    ...valid,
    requestId: crypto.randomUUID(),
    expectedVersion: saved.collection.expectedVersion,
    credits: saved.collection.items.map((row) => creditItem(row)),
  }

  const noOp = await f.run(f.service.setRecordingCredits(noOpInput, now, wire))
  const envelopeBytes = fixtureWire('').successBytes({ ...noOp, status: 'replayed' })
  const exactWire = fixtureWire('x'.repeat(256 * 1024 - envelopeBytes))
  const excessWire = fixtureWire('x'.repeat(256 * 1024 - envelopeBytes + 1))
  expect(exactWire.successBytes({ ...noOp, status: 'replayed' })).toBe(256 * 1024)
  expect(
    (
      await f.run(
        f.service.setRecordingCredits(
          { ...noOpInput, requestId: crypto.randomUUID() },
          now,
          exactWire,
        ),
      )
    ).changed,
  ).toBe(false)
  expect(
    await f.run(
      code(
        f.service.setRecordingCredits(
          { ...noOpInput, requestId: crypto.randomUUID() },
          now,
          excessWire,
        ),
      ),
    ),
  ).toBe('invalid_input')
  expect(
    await f.run(
      code(f.service.setRecordingCredits(noOpInput, now, fixtureWire('x'.repeat(256 * 1024)))),
    ),
  ).toBe('invalid_input')
  expect(
    await f.run(
      code(f.service.readRecordingCredits({ target }, fixtureWire('x'.repeat(256 * 1024)))),
    ),
  ).toBe('invalid_input')
  expect(await f.db.get(sql`SELECT count(*) AS n FROM mcp_operations`)).toEqual({ n: 3 })

  const final = {
    ...valid,
    requestId: crypto.randomUUID(),
    expectedVersion: saved.collection.expectedVersion,
    credits: [],
  }

  await f.db.update(user).set({ role: 'editor' }).where(eq(user.id, 'owner'))
  expect(await f.run(code(f.service.setRecordingCredits(final, now, wire)))).toBe('access_denied')
  expect(await f.db.get(sql`SELECT count(*) AS n FROM mcp_operations`)).toEqual({ n: 3 })

  await f.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  await f.db.update(musicRecordingCreditsTable).set({ evidenceNote: '🎷'.repeat(1000) })
  expect(
    await f.run(f.service.readRecordingCredits({ target, editable: true, limit: 50 }, wire)),
  ).toMatchObject({ status: 'over_limit', reason: 'bytes' })
  const [sample] = await f.db.select().from(musicRecordingCreditsTable).limit(1)

  if (!sample) throw new Error('Expected fixture credit')
  await f.db.insert(musicRecordingCreditsTable).values({
    ...sample,
    id: crypto.randomUUID(),
    creditedName: 'Extra',
    creditedNameKey: 'extra',
    participantKey: 'name:extra',
    displayOrder: 50,
  })

  const overLimit = await f.run(
    f.service.readRecordingCredits({ target, editable: true, limit: 50 }, wire),
  )

  expect(overLimit).toMatchObject({ status: 'over_limit', reason: 'items' })
  expect(overLimit).not.toHaveProperty('items')
  expect(overLimit).not.toHaveProperty('expectedVersion')
}, 15_000)

test('real OAuth authority admits catalogue write scope and blocks revoked replay or a read-only grant', async () => {
  await using f = await fixture()

  const oauthAuthority = async (scopes: string) => {
    const clientId = await f.register(scopes)
    // Disposable D1 ONLY: production policy deliberately remains unchanged.
    await f.db.update(oauthResource).set({
      allowedScopes: JSON.stringify(['catalogue:read', 'catalogue:write', 'offline_access']),
    })

    const tokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (await f.exchange(clientId, await f.authorize(clientId, 'owner', scopes))).json(),
    )

    const principal = await Effect.runPromise(f.oauth.verify(tokens.access_token))

    const authority = await Effect.runPromise(
      makeOAuthCommandAuthority(tokens.access_token, principal).pipe(
        Effect.provideService(Database, f.db),
        Effect.provideService(ConfigService, f.config),
        Effect.provideService(EditorialOAuth, f.oauth),
      ),
    )

    return { clientId, authority }
  }

  const writer = await oauthAuthority('catalogue:read catalogue:write offline_access')

  const input = {
    requestId: crypto.randomUUID(),
    expectedVersion: await f.aliasesVersion(),
    artistId: 'a',
    aliases: [{ name: 'Stage', ...evidence }],
  }

  expect((await f.run(f.service.setArtistAliases(input, now, wire), writer.authority)).status).toBe(
    'applied',
  )
  const reader = await oauthAuthority('catalogue:read offline_access')
  expect(
    await f.run(
      code(
        f.service.setArtistAliases(
          { ...input, requestId: crypto.randomUUID(), expectedVersion: await f.aliasesVersion() },
          now,
          wire,
        ),
      ),
      reader.authority,
    ),
  ).toBe('access_denied')
  await f.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, writer.clientId))
  expect(await f.run(code(f.service.setArtistAliases(input, now, wire)), writer.authority)).toBe(
    'access_denied',
  )
  expect(await f.db.get(sql`SELECT count(*) AS n FROM mcp_operations`)).toEqual({ n: 1 })
  expect(await f.db.get(sql`SELECT revision FROM music_artists WHERE id='a'`)).toEqual({
    revision: 1,
  })
}, 15_000)

test('album-wide facts stay separate; explicit unlink permits artist deletion without inferred merges', async () => {
  await using f = await fixture()
  const albumTarget = { type: 'album', id: 'album' }

  const albumPage = await f.run(
    f.service.readRecordingCredits({ target: albumTarget, editable: true }, wire),
  )

  const albumVersion = Schema.decodeUnknownSync(Schema.Struct({ expectedVersion: MusicVersion }))(
    albumPage,
  ).expectedVersion

  const album = await f.run(
    f.service.setRecordingCredits(
      {
        requestId: crypto.randomUUID(),
        expectedVersion: albumVersion,
        target: albumTarget,
        credits: [{ creditedName: 'Producer', role: 'producer', ...evidence }],
      },
      now,
      wire,
    ),
  )

  const track = await f.run(
    f.service.setRecordingCredits(
      {
        requestId: crypto.randomUUID(),
        expectedVersion: await f.creditsVersion(),
        target,
        credits: [{ artistId: 'a', creditedName: 'Primary', role: 'performer', ...evidence }],
      },
      now,
      wire,
    ),
  )

  expect(await f.run(f.service.readRecordingCredits({ target: albumTarget }, wire))).toMatchObject({
    items: [{ creditedName: 'Producer' }],
  })
  expect(await f.run(f.service.readRecordingCredits({ target }, wire))).toMatchObject({
    items: [{ creditedName: 'Primary' }],
  })
  await expect(
    f.db.delete(musicArtistsTable).where(eq(musicArtistsTable.id, 'a')).run(),
  ).rejects.toThrow()

  if (track.collection.kind !== 'recording_credits') throw new Error('Expected credit collection')
  const [item] = track.collection.items

  if (!item) throw new Error('Expected track credit')

  const input = {
    requestId: crypto.randomUUID(),
    expectedVersion: track.collection.expectedVersion,
    target,
    credits: [{ ...creditItem(item), artistId: null }],
  }

  const unlinked = await f.run(f.service.setRecordingCredits(input, now + 1, wire))
  expect(unlinked.collection.items).toMatchObject([{ id: item.id, createdAt: item.createdAt }])
  expect(unlinked.collection.items[0]).not.toHaveProperty('artistId')
  await f.db.delete(musicArtistsTable).where(eq(musicArtistsTable.id, 'a'))
  expect(await f.db.select().from(musicArtistsTable)).toMatchObject([{ id: 'b', name: 'Second' }])
  expect(
    await f.run(f.service.readRecordingCredits({ target: albumTarget, editable: true }, wire)),
  ).toMatchObject({ expectedVersion: album.collection.expectedVersion })
  expect(await f.db.select().from(musicTracksTable)).toMatchObject([
    { revision: 2, artistNames: ['Old billing'] },
  ])
}, 15_000)
