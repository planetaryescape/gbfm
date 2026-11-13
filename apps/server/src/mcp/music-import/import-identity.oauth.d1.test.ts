import { eq, sql } from 'drizzle-orm'
import { expect, test } from 'vitest'

import {
  musicAlbumsTable,
  musicEntityLinksTable,
  musicSourceAliasesTable,
  musicSourceIdentitiesTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import type { ScrapedLink } from '@/services/music-link-scraper.service'

import { imported, setup } from './import-oauth.fixture'

const recordingLink = (
  matchedUrl: string,
  recordingId = '89d6a0f5-5c76-4307-a51f-4fadb97712d1',
): ScrapedLink => ({
  platform: 'musicbrainz',
  url: `https://musicbrainz.org/recording/${recordingId}`,
  scrapedAt: new Date(),
  metadata: {
    discoveredBy: 'musicbrainz',
    confidence: 'exact_url',
    mbidType: 'recording',
    mbid: recordingId,
    canonicalMbid: recordingId,
    matchedUrl,
  },
})

test('cross-provider discovery cannot substitute an incumbent with a different exact Spotify album', async () => {
  await using f = await setup()
  f.state.links.push({
    platform: 'apple_music',
    url: 'https://music.apple.com/us/album/disposable/123456',
    scrapedAt: new Date(),
  })

  const original = {
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/album/DifferentExistingRelease',
    expectedType: 'album' as const,
    artworkDelivery: 'preserve' as const,
  }

  const old = imported(await f.call(original)).result.structuredContent.import

  const candidate = {
    ...original,
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/album/2T3Qwtj4INKHAAXD7WzFd8',
  }

  expect(await f.call(candidate)).toMatchObject({
    result: { isError: true, content: [{ text: expect.stringContaining('conflict') }] },
  })
  expect(await f.fixture.db.select().from(musicAlbumsTable)).toHaveLength(1)
  expect(
    (
      await f.fixture.db
        .select()
        .from(musicEntityLinksTable)
        .where(eq(musicEntityLinksTable.entityId, old.catalogue.entityId))
    ).find((link) => link.platform === 'spotify')?.url,
  ).toBe(original.url)
}, 30000)

test('exact MusicBrainz recording evidence reuses alternate Spotify tracks without replacing listening links', async () => {
  await using f = await setup()
  f.state.metadataType.value = 'song'

  const original = {
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/track/OriginalRecording',
    expectedType: 'track' as const,
    artworkDelivery: 'preserve' as const,
  }

  f.state.links.push(recordingLink(original.url))
  const firstResponse = await f.call(original)
  expect(firstResponse).not.toHaveProperty('result.isError', true)
  const first = imported(firstResponse).result.structuredContent.import
  const before = await f.fixture.db.select().from(musicEntityLinksTable)

  const alternate = {
    ...original,
    requestId: crypto.randomUUID(),
    url: 'https://open.spotify.com/track/DeluxeRecording',
  }

  f.state.links.splice(0, f.state.links.length, recordingLink(alternate.url))

  const response = await f.call(alternate)
  expect(response).not.toHaveProperty('result.isError', true)
  const result = imported(response).result.structuredContent.import
  expect(result).toMatchObject({
    receipt: 'applied',
    completion: 'complete',
    catalogue: {
      disposition: 'reused',
      entityType: 'track',
      entityId: first.catalogue.entityId,
      revision: first.catalogue.revision + 1,
      sourceKey: 'spotify:track:DeluxeRecording',
      canonicalUrl: alternate.url,
    },
  })
  expect(await f.fixture.db.select().from(musicTracksTable)).toHaveLength(1)
  expect(await f.fixture.db.select().from(musicEntityLinksTable)).toEqual(before)
  const identities = await f.fixture.db.select().from(musicSourceIdentitiesTable)
  expect(identities.filter((identity) => identity.platform === 'spotify')).toEqual(
    expect.arrayContaining(
      ['OriginalRecording', 'DeluxeRecording'].map((id) =>
        expect.objectContaining({
          sourceKey: `spotify:track:${id}`,
          state: 'resolved',
          entityType: 'track',
          entityId: first.catalogue.entityId,
        }),
      ),
    ),
  )
  expect(
    await f.fixture.db
      .select()
      .from(musicSourceAliasesTable)
      .where(eq(musicSourceAliasesTable.normalizedUrl, alternate.url)),
  ).toMatchObject([{ sourceKey: 'spotify:track:DeluxeRecording' }])

  await f.restart()
  expect(imported(await f.call(alternate)).result.structuredContent.import).toEqual({
    ...result,
    receipt: 'replayed',
  })

  const reused = imported(await f.call({ ...alternate, requestId: crypto.randomUUID() })).result
    .structuredContent.import

  expect(reused.catalogue).toEqual(result.catalogue)
  expect(f.state.scrapes).toBe(2)
  expect(await f.fixture.db.select().from(musicEntityLinksTable)).toEqual(before)
}, 30000)

test.each([
  'missing incoming evidence',
  'non-exact incoming match',
  'ISRC-only incoming match',
  'different matched source',
  'non-recording MusicBrainz identity',
  'different recording',
  'missing original evidence',
  'rejected original recording link',
  'rejected original Spotify link',
])(
  'alternate Spotify tracks reject %s without changing the incumbent',
  async (scenario) => {
    await using f = await setup()
    f.state.metadataType.value = 'song'

    const original = {
      requestId: crypto.randomUUID(),
      url: 'https://open.spotify.com/track/OriginalRecording',
      expectedType: 'track' as const,
      artworkDelivery: 'preserve' as const,
    }

    const sharedLink: ScrapedLink = {
      platform: 'apple_music',
      url: 'https://music.apple.com/us/album/disposable/123456?i=654321',
      scrapedAt: new Date(),
    }

    f.state.links.push(sharedLink, recordingLink(original.url))
    const first = imported(await f.call(original)).result.structuredContent.import

    const alternate = {
      ...original,
      requestId: crypto.randomUUID(),
      url: 'https://open.spotify.com/track/DeluxeRecording',
    }

    let proposed = recordingLink(alternate.url)

    switch (scenario) {
      case 'missing incoming evidence':
        proposed.metadata = undefined
        break
      case 'non-exact incoming match':
        proposed.metadata = { ...proposed.metadata, confidence: 'search' }
        break
      case 'ISRC-only incoming match':
        proposed.metadata = { ...proposed.metadata, confidence: 'exact_isrc', matchedUrl: null }
        break
      case 'different matched source':
        proposed.metadata = { ...proposed.metadata, matchedUrl: original.url }
        break
      case 'non-recording MusicBrainz identity':
        proposed.metadata = { ...proposed.metadata, mbidType: 'release-group' }
        break
      case 'different recording':
        proposed = recordingLink(alternate.url, '1a24a7bc-4e39-49e0-ac13-21ea38290f0d')
        break
      case 'missing original evidence':
        await f.fixture.db
          .update(musicEntityLinksTable)
          .set({ metadata: null })
          .where(eq(musicEntityLinksTable.platform, 'musicbrainz'))
        break
      case 'rejected original recording link':
      case 'rejected original Spotify link':
        await f.fixture.db
          .update(musicEntityLinksTable)
          .set({ status: 'rejected' })
          .where(
            eq(
              musicEntityLinksTable.platform,
              scenario === 'rejected original Spotify link' ? 'spotify' : 'musicbrainz',
            ),
          )
        break
    }

    const before = await f.fixture.db.select().from(musicEntityLinksTable)
    const tracks = await f.fixture.db.select().from(musicTracksTable)
    const aliases = await f.fixture.db.select().from(musicSourceAliasesTable)
    f.state.links.splice(0, f.state.links.length, sharedLink, proposed)

    expect(await f.call(alternate)).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('conflict') }] },
    })
    expect(await f.fixture.db.select().from(musicEntityLinksTable)).toEqual(before)
    expect(await f.fixture.db.select().from(musicTracksTable)).toEqual(tracks)
    expect(await f.fixture.db.select().from(musicSourceAliasesTable)).toEqual(aliases)
    expect(
      await f.fixture.db
        .select()
        .from(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.sourceKey, 'spotify:track:DeluxeRecording')),
    ).toEqual([])
    expect(await f.fixture.db.get(sql`SELECT COUNT(*) AS count FROM mcp_operations`)).toEqual({
      count: 1,
    })
    expect((await f.fixture.db.select().from(musicTracksTable))[0]?.id).toBe(
      first.catalogue.entityId,
    )
  },
  30000,
)

test('legacy exact-source adoption preserves known-good verified link metadata instead of treating it as a new release', async () => {
  await using f = await setup()
  const id = crypto.randomUUID()
  const url = 'https://open.spotify.com/album/LegacyExactRelease'
  await f.fixture.db
    .insert(musicAlbumsTable)
    .values({ id, title: 'Known-good metadata', slug: `legacy-${id}` })

  const link = {
    id: crypto.randomUUID(),
    entityType: 'album' as const,
    entityId: id,
    platform: 'spotify' as const,
    url,
    metadata: { discoveredBy: 'manual', confidence: 'exact_source' },
  }

  await f.fixture.db.insert(musicEntityLinksTable).values(link)

  const before = await f.fixture.db
    .select()
    .from(musicEntityLinksTable)
    .where(eq(musicEntityLinksTable.id, link.id))

  const result = imported(
    await f.call({
      requestId: crypto.randomUUID(),
      url,
      expectedType: 'album',
      artworkDelivery: 'preserve',
    }),
  ).result.structuredContent.import

  expect(result.catalogue).toMatchObject({ disposition: 'reused', entityId: id })
  expect(f.state.scrapes).toBe(0)
  expect(
    await f.fixture.db
      .select()
      .from(musicEntityLinksTable)
      .where(eq(musicEntityLinksTable.id, link.id)),
  ).toEqual(before)
  expect(
    (await f.fixture.db.select().from(musicAlbumsTable).where(eq(musicAlbumsTable.id, id)))[0]
      ?.title,
  ).toBe('Known-good metadata')
}, 30000)
