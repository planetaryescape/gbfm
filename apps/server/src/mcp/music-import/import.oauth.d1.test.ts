import { eq, sql } from 'drizzle-orm'
import { Redacted, Schema } from 'effect'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import {
  musicAlbumsTable,
  musicEntityLinksTable,
  musicSourceIdentitiesTable,
} from '@/db/music-entity.schema'
import { oauthAccessToken } from '@/db/oauth.schema'
import { OAuthTokens } from '@/test/editorial-oauth'

import { imported, setup } from './import-oauth.fixture'

test.each(['preserve', 'required'] as const)(
  'expiry after import commit refreshes and replays %s artwork without duplicate imports',
  async (artworkDelivery) => {
    await using f = await setup()
    f.state.expireAfterCommit = true

    const input = {
      requestId: crypto.randomUUID(),
      url: 'https://open.spotify.com/album/2T3Qwtj4INKHAAXD7WzFd8',
      expectedType: 'album' as const,
      artworkDelivery,
    }

    const response = await f.send('tools/call', { name: 'import_music_url', arguments: input })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"')
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('')

    const rows = await f.fixture.db.select().from(musicAlbumsTable)
    expect(rows).toHaveLength(1)
    expect(f.state.scrapes).toBe(1)
    expect(f.state.puts).toBe(0)

    const refreshed = await f.fixture.request('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: f.clientId,
      refresh_token: Redacted.value(f.tokens.refresh_token),
      resource: f.fixture.config.mcp.resourceUrl,
    })

    expect(refreshed.status).toBe(200)
    const tokens = Schema.decodeUnknownSync(OAuthTokens)(await refreshed.json())

    const result = imported(await f.call(input, 'import_music_url', tokens.access_token)).result
      .structuredContent.import

    expect(result).toMatchObject({
      receipt: 'replayed',
      completion: 'complete',
      catalogue: { disposition: 'created', entityId: rows[0]?.id },
    })
    expect(f.state.scrapes).toBe(1)
    expect(await f.fixture.db.select().from(musicAlbumsTable)).toHaveLength(1)
    expect(result.artwork.phase).toBe(artworkDelivery === 'required' ? 'delivered' : 'preserved')
    expect(f.state.fetches).toBe(artworkDelivery === 'required' ? 1 : 0)
    expect(f.state.puts).toBe(artworkDelivery === 'required' ? 1 : 0)
  },
  30000,
)

test('composed OAuth discovery, exact source import, original receipt replay, conflict and revoked replay', async () => {
  await using f = await setup()
  const readId = await f.fixture.register('posts:read offline_access')

  const readTokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await f.fixture.exchange(
        readId,
        await f.fixture.authorize(readId, 'owner', 'posts:read offline_access'),
      )
    ).json(),
  )

  const names = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
  )

  const adminTools = names(await f.rpc('tools/list', {})).result.tools.map((tool) => tool.name)
  expect(adminTools).toContain('import_music_url')

  const readTools = names(await f.rpc('tools/list', {}, readTokens.access_token)).result.tools.map(
    (tool) => tool.name,
  )

  expect(readTools).not.toContain('import_music_url')
  expect(readTools).not.toContain('get_music_import_status')
  expect(adminTools.filter((name) => !readTools.includes(name)).sort()).toEqual([
    'get_music_import_status',
    'import_music_url',
  ])

  const input = {
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/album/2T3Qwtj4INKHAAXD7WzFd8',
    expectedType: 'album' as const,
    artworkDelivery: 'preserve' as const,
  }

  const other = crypto.randomUUID()
  await f.fixture.db
    .insert(musicAlbumsTable)
    .values({ id: other, title: 'Sein Name ist helmuth', slug: `different-${other}` })
  await f.fixture.db.insert(musicEntityLinksTable).values({
    id: crypto.randomUUID(),
    entityType: 'album',
    entityId: other,
    platform: 'spotify',
    url: 'https://open.spotify.com/album/DifferentExactAlbum',
  })
  expect(await f.call(input, 'import_music_url', readTokens.access_token)).toMatchObject({
    result: { isError: true },
  })
  expect(f.state.scrapes).toBe(0)

  const invalid = await f.rpc('tools/call', {
    name: 'import_music_url',
    arguments: { ...input, requestId: crypto.randomUUID(), unexpected: 'must-not-be-ignored' },
  })

  expect(invalid).not.toHaveProperty('result.structuredContent')
  expect(f.state.scrapes).toBe(0)
  const first = imported(await f.call(input)).result.structuredContent.import
  expect(first).toMatchObject({
    receipt: 'applied',
    completion: 'complete',
    catalogue: {
      disposition: 'created',
      entityType: 'album',
      sourceKey: 'spotify:album:2T3Qwtj4INKHAAXD7WzFd8',
    },
    artwork: { phase: 'preserved' },
  })
  expect(first.catalogue.entityId).not.toBe(other)
  await f.restart()

  const replay = imported(await f.call({ ...input, url: `${input.url}?si=discarded` })).result
    .structuredContent.import

  expect(replay).toEqual({ ...first, receipt: 'replayed' })
  expect(f.state.scrapes).toBe(1)
  expect(await f.call({ ...input, artworkDelivery: 'required' })).toMatchObject({
    result: { isError: true, content: [{ text: expect.stringContaining('conflict') }] },
  })
  expect(f.state.scrapes).toBe(1)

  const status = imported(await f.call(input, 'get_music_import_status')).result.structuredContent
    .import

  expect(status.catalogue).toEqual(first.catalogue)
  await f.fixture.db.update(oauthAccessToken).set({ revoked: new Date() })

  const response = await f.rpc(
    'tools/call',
    { name: 'import_music_url', arguments: input },
    f.tokens.access_token,
    401,
  )

  expect(response).toBeNull()
}, 30000)

test('concurrent identical request keys and distinct keys converge without losing original created disposition', async () => {
  await using f = await setup()

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'preserve' as const,
  }

  const values = await Promise.all(
    Array.from(
      { length: 5 },
      async () => imported(await f.call(input)).result.structuredContent.import,
    ),
  )

  expect(new Set(values.map((value) => value.catalogue.entityId)).size).toBe(1)
  expect(values.every((value) => value.catalogue.disposition === 'created')).toBe(true)

  const reuse = imported(await f.call({ ...input, requestId: crypto.randomUUID() })).result
    .structuredContent.import

  expect(reuse.catalogue).toEqual({ ...values[0]?.catalogue, disposition: 'reused' })
  expect(await f.fixture.db.select().from(musicSourceIdentitiesTable)).toHaveLength(1)
}, 30000)

test('expired preserve receipts never create again, role downgrade denies replay, and inferred playlists cannot bypass admission', async () => {
  await using f = await setup()

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'preserve' as const,
  }

  const first = imported(await f.call(input)).result.structuredContent.import
  await f.fixture.db.update(user).set({ role: 'editor' }).where(eq(user.id, 'owner'))
  await f.rpc(
    'tools/call',
    { name: 'import_music_url', arguments: input },
    f.tokens.access_token,
    401,
  )
  await f.fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  const created = Date.now() - 86400001
  await f.fixture.db.run(
    sql`UPDATE mcp_operations SET created_at = ${created}, expires_at = ${created + 86400000} WHERE id = ${first.operationId}`,
  )
  expect(await f.call(input)).toMatchObject({
    result: { isError: true, content: [{ text: expect.stringContaining('expired') }] },
  })
  expect(f.state.scrapes).toBe(1)
  f.state.inferredPlaylist = true

  const denied = await f.call({
    requestId: crypto.randomUUID(),
    url: 'https://soundcloud.com/controlled/generic',
    artworkDelivery: 'preserve',
  })

  expect(denied).toMatchObject({
    result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
  })
  expect(await f.fixture.db.select().from(musicAlbumsTable)).toHaveLength(1)
}, 30000)

test('persisted OAuth revocation after the final JS authorization is rejected by the atomic SQL guard', async () => {
  await using f = await setup()
  f.state.revokeAtSql = true

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  const denied = await f.send('tools/call', { name: 'import_music_url', arguments: input })
  expect(denied.status).toBe(401)
  expect(denied.headers.get('www-authenticate')).toContain('error="invalid_token"')
  expect(await denied.text()).toBe('')
  expect(await f.fixture.db.select().from(musicAlbumsTable)).toEqual([])
  expect(await f.fixture.db.get(sql`SELECT COUNT(*) AS count FROM mcp_operations`)).toEqual({
    count: 0,
  })
  expect(await f.fixture.db.get(sql`SELECT COUNT(*) AS count FROM mcp_operation_artwork`)).toEqual({
    count: 0,
  })
  expect(f.state.puts).toBe(0)
  await f.fixture.db.update(oauthAccessToken).set({ revoked: null })
  expect(imported(await f.call(input)).result.structuredContent.import.catalogue.disposition).toBe(
    'created',
  )
}, 30000)

test('id-less transport calls cannot import before a usable encoded response budget exists', async () => {
  await using f = await setup()

  const input = {
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/album/NoResponseBudget',
    expectedType: 'album',
    artworkDelivery: 'required',
  }

  const response = await f.send(
    'tools/call',
    { name: 'import_music_url', arguments: input },
    f.tokens.access_token,
    null,
  )

  await response.text()
  expect(f.state.scrapes).toBe(0)
  expect(f.state.puts).toBe(0)
  expect(await f.fixture.db.select().from(musicAlbumsTable)).toEqual([])
  expect(await f.fixture.db.get(sql`SELECT COUNT(*) AS count FROM mcp_operations`)).toEqual({
    count: 0,
  })
}, 30000)
