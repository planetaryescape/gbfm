import { eq } from 'drizzle-orm'
import { Schema } from 'effect'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { mcpOperations } from '@/db/mcp-operation.schema'
import { musicAlbumsTable, musicEntityLinksTable } from '@/db/music-entity.schema'
import { oauthResource } from '@/db/oauth.schema'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { LinkEditResult } from '@/mcp/link-edit/contracts'
import { createMcpOperationStore } from '@/mcp/operations/store'
import { OAuthTokens } from '@/test/editorial-oauth'
import { publishingFixture } from '@/test/mcp-publishing'

const fixture = async () => {
  const h = await publishingFixture()

  try {
    await seedMusicLookups(h.db)
    await h.db.update(oauthResource).set({
      allowedScopes: JSON.stringify([
        'posts:read',
        'drafts:write',
        'micros:publish',
        'content:publish',
        'catalogue:write',
        'offline_access',
      ]),
    })
    await h.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'other'))
    const client = await h.register('catalogue:write offline_access')

    const admin = Schema.decodeUnknownSync(OAuthTokens)(
      await (
        await h.exchange(
          client,
          await h.authorize(client, 'other', 'catalogue:write offline_access'),
        )
      ).json(),
    )

    const entityId = crypto.randomUUID()
    await h.db.insert(musicAlbumsTable).values({
      id: entityId,
      slug: entityId,
      title: 'Disposable album',
      artistNames: ['Disposable artist'],
    })

    return {
      ...h,
      admin,
      entityId,
      attach: async (input: Schema.Json) =>
        (await h.call('attach_music_link', input, admin.access_token)).body,
    }
  } catch (error) {
    await h[Symbol.asyncDispose]()
    throw error
  }
}

const result = Schema.decodeUnknownSync(
  Schema.Struct({ result: Schema.Struct({ structuredContent: LinkEditResult }) }),
)

test('production attachment uses admin consent, canonical links and original durable revisions without enabling removal', async () => {
  await using h = await fixture()

  const listing = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
  )

  const names = listing(
    await (await h.rpc('tools/list', {}, h.admin.access_token)).json(),
  ).result.tools.map((tool) => tool.name)

  expect(names).toContain('attach_music_link')
  expect(names).not.toContain('reject_music_link')
  expect(names).not.toContain('remove_music_link')
  expect(
    listing(await (await h.rpc('tools/list', {})).json()).result.tools.map((tool) => tool.name),
  ).not.toContain('attach_music_link')

  const inputs = [
    { platform: 'tidal', url: 'https://tidal.com/browse/album/12345' },
    { platform: 'apple_music', url: 'https://music.apple.com/us/album/disposable-album/12345' },
    { platform: 'bandcamp', url: 'https://disposable-fixture.bandcamp.com/album/disposable-album' },
  ].map((link, expectedRevision) => ({
    ...link,
    entityType: 'album',
    entityId: h.entityId,
    expectedRevision,
    requestId: crypto.randomUUID(),
  }))

  for (const input of inputs) {
    expect(result(await h.attach(input)).result.structuredContent.result).toMatchObject({
      status: 'applied',
      outcome: { revision: { revision: input.expectedRevision + 1 } },
    })
  }

  const links = await h.db.select().from(musicEntityLinksTable)
  expect(links).toHaveLength(3)

  for (const input of inputs)
    expect(links).toContainEqual(
      expect.objectContaining({
        entityId: h.entityId,
        platform: input.platform,
        url: input.url,
        status: 'verified',
      }),
    )
  const first = inputs[0]

  if (!first) throw new Error('Missing input')
  await h.restart()
  const replays = await Promise.all([h.attach(first), h.attach(first)])

  for (const replay of replays)
    expect(result(replay).result.structuredContent.result).toMatchObject({
      status: 'replayed',
      outcome: { revision: { revision: 1 } },
    })
  expect(await h.db.select().from(musicEntityLinksTable)).toEqual(links)
  expect(await h.db.select().from(mcpOperations)).toHaveLength(3)
  expect(
    result(await h.attach({ ...first, expectedRevision: 3 })).result.structuredContent.result,
  ).toHaveProperty('status', 'conflict')
  expect(
    result(await h.attach({ ...first, requestId: crypto.randomUUID() })).result.structuredContent
      .result,
  ).toHaveProperty('status', 'conflict')
  const read = await h.publicRead(`/api/music/album/${h.entityId}/links`)
  expect(read.status).toBe(200)
  expect(JSON.stringify(await read.json())).toContain(inputs[2]?.url)
  expect(h.copies).toEqual([])
  await createMcpOperationStore(h.database).pruneExpired(Date.now() + 86_400_001)
  expect(result(await h.attach(first)).result.structuredContent.result).toHaveProperty(
    'status',
    'expired',
  )
}, 60_000)

test('attachment rejects unsafe or mismatched sources, lacks silent replacement and rechecks admin role on replay', async () => {
  await using h = await fixture()

  const input = {
    entityType: 'album',
    entityId: h.entityId,
    requestId: crypto.randomUUID(),
    expectedRevision: 0,
    platform: 'tidal',
    url: 'https://tidal.com/browse/album/12345',
  }

  expect((await h.call('attach_music_link', input)).body).toMatchObject({
    result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
  })

  for (const url of [
    'http://tidal.com/browse/album/12345',
    'https://tidal.com.attacker.test/browse/album/12345',
    'https://music.apple.com/us/album/disposable/12345',
    'https://localhost/album/12345',
    'https://user:password@tidal.com/browse/album/12345',
  ]) {
    expect(
      JSON.stringify(await h.attach({ ...input, requestId: crypto.randomUUID(), url })),
    ).toContain('invalid_input')
  }

  expect(await h.db.select().from(musicEntityLinksTable)).toEqual([])
  expect(await h.db.select().from(mcpOperations)).toEqual([])
  expect(result(await h.attach(input)).result.structuredContent.result).toHaveProperty(
    'status',
    'applied',
  )
  expect(
    result(
      await h.attach({
        ...input,
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
        url: 'https://tidal.com/browse/album/67890',
      }),
    ).result.structuredContent.result,
  ).toHaveProperty('status', 'conflict')
  await h.db.update(user).set({ role: 'editor' }).where(eq(user.id, 'other'))
  const denied = await h.call('attach_music_link', input, h.admin.access_token)
  expect(denied.status === 401 || JSON.stringify(denied.body).includes('access_denied')).toBe(true)
  expect(await h.db.select().from(musicEntityLinksTable)).toHaveLength(1)
  expect(await h.db.select().from(mcpOperations)).toHaveLength(1)
}, 60_000)
