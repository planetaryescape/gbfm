import { McpPrincipal, McpResourceUrl } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Result, Schema } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { McpActor, McpAuthorizationLive } from '@/mcp/authorization'
import { McpToolError } from '@/mcp/contracts'
import { db } from '@/test/d1'
import { withTestLayer } from '@/test/effect'

import { type CreateArtistInput, MusicImportCommands, MusicImportCommandsLayer } from './commands'

const actorId = 'i1-admin'

const resource = Schema.decodeUnknownSync(McpResourceUrl)('https://api.example.test/mcp')

const principal = Schema.decodeUnknownSync(McpPrincipal)({
  userId: actorId,
  clientId: 'i1-client',
  scopes: ['catalogue:write', 'catalogue:import', 'providers:read', 'playlists:write'],
})

const layer = MusicImportCommandsLayer.pipe(
  Layer.provide(McpAuthorizationLive),
  Layer.provide(Layer.succeed(Database, db)),
)

const prepare = (raw: Schema.Json, actor = principal, audience = resource) =>
  Effect.runPromise(
    withTestLayer(
      Effect.flatMap(MusicImportCommands, (commands) => commands.prepare(raw, audience)),
      layer,
    ).pipe(Effect.provideService(McpActor, actor), Effect.result),
  )

const create = (input: Partial<typeof CreateArtistInput.Type> = {}) => ({
  operation: 'create_artist',
  input: {
    requestId: 'e3e746f2-b372-43de-a093-89eced3929ee',
    name: 'Artist',
    slug: 'artist',
    ...input,
  },
})

const imported = (url = 'https://open.spotify.com/track/Abc123?si=tracking') => ({
  operation: 'import_music_url',
  input: { requestId: crypto.randomUUID(), url, artworkDelivery: 'preserve' },
})

const success = <A, E>(result: Result.Result<A, E>) => {
  expect(Result.isSuccess(result)).toBe(true)

  if (Result.isFailure(result)) throw new Error('Expected command preparation success')

  return result.success
}

beforeAll(async () => {
  await db.insert(user).values({ id: actorId, email: 'i1@example.test', name: 'I1', role: 'admin' })
})

test('prepares all five selected commands without creating catalogue rows or receipts', async () => {
  for (const command of [
    create(),
    {
      operation: 'create_album',
      input: {
        requestId: crypto.randomUUID(),
        title: 'Album',
        slug: 'album',
        artistIds: ['artist-b', 'artist-a'],
        releaseDate: '2026-11-07T00:00:00.000Z',
      },
    },
    {
      operation: 'create_track',
      input: {
        requestId: crypto.randomUUID(),
        title: 'Track',
        slug: 'track',
        albumId: null,
        trackNumber: 2,
      },
    },
    {
      operation: 'create_label',
      input: { requestId: crypto.randomUUID(), name: 'Label', slug: 'label', content: '' },
    },
    imported(),
  ]) {
    const prepared = success(await prepare(command))
    expect(prepared.receiptScope).toMatchObject({
      actorId,
      clientId: 'i1-client',
      resource,
      operation: command.operation,
    })
    expect(prepared.inputHash).toMatch(/^[a-f0-9]{64}$/)
  }

  expect(await db.query.musicArtistsTable.findMany()).toEqual([])
  expect(await db.query.musicAlbumsTable.findMany()).toEqual([])
  expect(await db.query.musicTracksTable.findMany()).toEqual([])
  expect(await db.query.musicLabelsTable.findMany()).toEqual([])
  expect(await db.query.editorialOperations.findMany()).toEqual([])
})

test('fingerprints are key-order independent, URL-normalized and sensitive to null, order and changed payload', async () => {
  const original = success(await prepare(create()))

  const reordered = success(
    await prepare({
      operation: 'create_artist',
      input: { slug: 'artist', name: 'Artist', requestId: original.receiptScope.requestId },
    }),
  )

  expect(reordered.inputHash).toBe(original.inputHash)
  expect(success(await prepare(create({ bio: null }))).inputHash).not.toBe(original.inputHash)
  expect(success(await prepare(create({ name: 'Different' }))).inputHash).not.toBe(
    original.inputHash,
  )
  expect(success(await prepare(create({ genres: ['Jazz', 'Soul'] }))).inputHash).not.toBe(
    success(await prepare(create({ genres: ['Soul', 'Jazz'] }))).inputHash,
  )
  const first = success(await prepare(imported()))
  const second = success(await prepare(imported('https://open.spotify.com/track/Abc123')))
  expect(first.command.input).toHaveProperty('url', 'https://open.spotify.com/track/Abc123')
  expect(first.inputHash).toBe(second.inputHash)
  expect(first.receiptScope.requestId).not.toBe(second.receiptScope.requestId)

  const anotherClient = success(
    await prepare(create(), {
      ...principal,
      clientId: Schema.decodeUnknownSync(McpPrincipal.fields.clientId)('another-client'),
    }),
  )

  expect(anotherClient.receiptScope.clientId).not.toBe(original.receiptScope.clientId)
  const otherResource = Schema.decodeUnknownSync(McpResourceUrl)('https://preview.example.test/mcp')
  const anotherAudience = success(await prepare(create(), principal, otherResource))
  expect(anotherAudience.receiptScope.resource).toBe(otherResource)
  expect(anotherAudience.inputHash).toBe(original.inputHash)
})

test('rejects excess fields, non-v4 IDs, label URL imports, unsafe URLs and encoded oversized content', async () => {
  expect(
    Result.isSuccess(
      await prepare({
        operation: 'create_label',
        input: {
          requestId: crypto.randomUUID(),
          name: 'Label',
          slug: 'label',
          content: '\u0001'.repeat(40_000),
        },
      }),
    ),
  ).toBe(true)

  for (const command of [
    { ...create(), input: { ...create().input, createdById: 'forged' } },
    create({ requestId: 'not-a-uuid' }),
    create({ requestId: 'e3e746f2-b372-13de-a093-89eced3929ee' }),
    create({ name: '  ' }),
    create({ genres: Array.from({ length: 51 }, () => 'Jazz') }),
    { ...imported(), input: { ...imported().input, expectedType: 'label' } },
    imported('https://127.0.0.1/music'),
    {
      operation: 'create_album',
      input: {
        requestId: crypto.randomUUID(),
        title: 'Album',
        slug: 'album',
        releaseDate: '2026-02-30T00:00:00.000Z',
      },
    },
    {
      operation: 'create_label',
      input: {
        requestId: crypto.randomUUID(),
        name: 'Label',
        slug: 'label',
        content: '\u0001'.repeat(50_000),
      },
    },
  ]) {
    expect(await prepare(command)).toMatchObject({ failure: { code: 'invalid_input' } })
  }
})

test('checks every import scope and inferred playlist authority', async () => {
  for (const scope of ['catalogue:write', 'catalogue:import', 'providers:read']) {
    const denied = await prepare(imported(), {
      ...principal,
      scopes: principal.scopes.filter((value) => value !== scope),
    })

    expect(denied).toMatchObject({ failure: { code: 'access_denied' } })

    if (Result.isSuccess(denied)) throw new Error('Expected authorization denial')
    const encoded = Schema.encodeSync(Schema.fromJsonString(McpToolError))(denied.failure)
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(McpToolError))(encoded).code).toBe(
      'access_denied',
    )
  }

  const noPlaylist = {
    ...principal,
    scopes: principal.scopes.filter((scope) => scope !== 'playlists:write'),
  }

  expect(
    await prepare(imported('https://open.spotify.com/playlist/Abc123'), noPlaylist),
  ).toMatchObject({ failure: { code: 'access_denied' } })
  expect(Result.isSuccess(await prepare(imported(), noPlaylist))).toBe(true)
  expect(success(await prepare(imported(), noPlaylist)).typeAuthority).toBe('resolved')
  expect(
    success(await prepare(imported('https://soundcloud.com/some-artist/sets/some-set'), noPlaylist))
      .typeAuthority,
  ).toBe('pending')
})

test('identical preparation rechecks persisted admin role, ban and deletion; no cached authority', async () => {
  expect(Result.isSuccess(await prepare(create()))).toBe(true)

  for (const role of ['creator', 'editor', 'user']) {
    await db.update(user).set({ role }).where(eq(user.id, actorId))
    expect(await prepare(create())).toMatchObject({ failure: { code: 'access_denied' } })
  }

  await db.update(user).set({ role: 'admin', banned: true }).where(eq(user.id, actorId))
  expect(await prepare(create())).toMatchObject({ failure: { code: 'access_denied' } })
  await db.delete(user).where(eq(user.id, actorId))
  expect(await prepare(create())).toMatchObject({ failure: { code: 'access_denied' } })
})
