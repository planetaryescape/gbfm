import { HealthLiveResponse, HealthReadyResponse } from '@gbfm/api/health'
import {
  AlbumListResponse,
  ArtistListResponse,
  EntityLinkResponse,
  LabelListResponse,
  LabelResponse,
  PlaylistListResponse,
  ResolvedMusicEntityResponse,
  ScrapeEntityLinksResponse,
  TrackListResponse,
} from '@gbfm/api/music'
import { MicroPostNeighboursResponse, MicroPostRandomUnreadResponse } from '@gbfm/api/navigation'
import {
  CompiledMicroPostResponse,
  CompiledPostResponse,
  GetMicroPostListResponse,
  GetMicroPostsResponse,
  MicroPostScreenRepliesResponse,
  MicroPostScreenResponse,
  MicroPostThreadResponse,
  PostResponse,
  PreviewPostContentResponse,
} from '@gbfm/api/post'
import { SearchResults } from '@gbfm/api/search'
import { decodeResponseBody } from '@gbfm/api/testing'
import { SiteMetadata } from '@gbfm/site-metadata'
import { SocialCardPresentation, TweetCardPresentation } from '@gbfm/social-card'
import { and, eq, inArray } from 'drizzle-orm'
import { Layer } from 'effect'
import { XMLValidator } from 'fast-xml-parser'
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { session, user } from '@/db/auth.schema'
import { replaceEntityLabels } from '@/db/labels'
import {
  musicAlbumsTable,
  musicArtistsTable,
  musicEntityLinksTable,
  musicEntityTypesTable,
  musicPlatformsTable,
  musicPlaylistsTable,
  musicSourceAliasesTable,
  musicSourceIdentitiesTable,
  musicTracksTable,
  musicLabelAlbumsTable,
  musicLabelArtistsTable,
  musicLabelCreatorsTable,
  musicLabelsTable,
} from '@/db/music-entity.schema'
import { navigationSessions } from '@/db/navigation.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { releasesTable } from '@/db/release.schema'
import { showSubscriptionsTable, showsTable } from '@/db/show.schema'
import { entityLabelsTable } from '@/db/tags.schema'
import { omitUndefined } from '@/lib/omit-undefined'
import { MusicCoverImageFetcher } from '@/services/canonical-music-identity/artwork-delivery'
import { ObjectStoreClient } from '@/services/storage/object-store-client'
import { d1, db } from '@/test/database'
import { createTestWebHandler } from '@/test/http-handler'

import type { createWebHandler } from './routes'

// Blackbox suite asserting only the wire contract, so these assertions keep
// working as more groups move from the Hono fallback onto the Effect router
// (docs/migration-effect-http-api.md).
let webHandler: ReturnType<typeof createWebHandler>

const writableObjectStoreLayer = Layer.succeed(ObjectStoreClient, {
  provider: 'r2',
  putObject: () => Promise.resolve(),
  presignPutObject: () => Promise.resolve('https://object-store.test/upload'),
  deleteObject: () => Promise.resolve(),
  copyObject: () => Promise.resolve(),
  headObject: () => Promise.resolve(null),
  listObjects: () => Promise.resolve([]),
  listBuckets: () => Promise.resolve([]),
  createMultipartUpload: () => Promise.resolve('upload-id'),
  presignUploadPart: () => Promise.resolve('https://object-store.test/part'),
  completeMultipartUpload: () => Promise.resolve(),
  abortMultipartUpload: () => Promise.resolve(),
  listMultipartParts: () => Promise.resolve([]),
} satisfies ObjectStoreClient)

beforeAll(async () => {
  // No longer imports @/app for its side effects: app.ts's initializeApp
  // runs against the module-level runtime singleton (src/runtime/index.ts),
  // which now intentionally dies resolving Database outside the Worker
  // request path (OPS-254). createTestWebHandler mirrors worker.ts's
  // per-request AppLayer composition instead, including its own
  // SentryServiceLayer, so nothing here depends on @/app's side effects.
  // It's built against the same migrated D1 database as `db`
  // (src/test/database.ts) so rows seeded directly through `db` are visible
  // through the handler's own Database layer.
  webHandler = createTestWebHandler(d1)
})

afterAll(async () => {
  await webHandler?.dispose()
})

describe('Effect router (Step 8: HonoFallback removed)', () => {
  it('unknown routes 404 via Effect HttpRouter.RouteNotFound (empty body -- no Hono notFound JSON, no fallback to serve)', async () => {
    const res = await webHandler.handler(new Request('http://localhost/does-not-exist'))

    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })

  it('retired Bluesky integration routes return 404 without invoking auth or sync', async () => {
    for (const [method, path] of [
      ['GET', '/api/integrations/bluesky'],
      ['POST', '/api/integrations/bluesky'],
      ['POST', '/api/integrations/bluesky/account-id/sync'],
      ['GET', '/api/integrations/bluesky/account-id/sync/run-id/status'],
      ['GET', '/api/integrations/bluesky/account-id/runs'],
      ['GET', '/api/integrations/bluesky/account-id/sources'],
      ['PATCH', '/api/integrations/bluesky/account-id/schedule'],
      ['PATCH', '/api/integrations/bluesky/sources/source-id'],
      ['DELETE', '/api/integrations/bluesky/account-id'],
    ]) {
      const res = await webHandler.handler(
        new Request(`http://localhost${path}`, method === undefined ? {} : { method }),
      )

      expect(res.status, `${method} ${path}`).toBe(404)
    }
  })
})

describe('better-auth route (Step 2c)', () => {
  it('GET /auth/get-session is handled by the auth route', async () => {
    const res = await webHandler.handler(new Request('http://localhost/auth/get-session'))

    // better-auth's own response for an unauthenticated session check, not a
    // RouteNotFound 404 -- proves /auth/* is matched ahead of everything else.
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it("unknown /auth/* paths are handled by better-auth, not Effect's own RouteNotFound", async () => {
    const withoutAuth = await webHandler.handler(new Request('http://localhost/does-not-exist'))
    const withAuth = await webHandler.handler(new Request('http://localhost/auth/does-not-exist'))

    // Both are empty-bodied 404s (Effect's own RouteNotFound and better-auth's
    // internal 404 are both content-length: 0), so the body can't
    // discriminate them -- this only proves /auth/* is matched by
    // better-auth's own handler rather than Effect's RouteNotFound path.
    expect(withoutAuth.status).toBe(404)
    expect(withAuth.status).toBe(404)
  })
})

describe('health (HttpApiBuilder group, Step 3a)', () => {
  it('GET /health/live returns 200 without checking the database', async () => {
    const res = await webHandler.handler(new Request('http://localhost/health/live'))

    expect(res.status).toBe(200)
    await expect(decodeResponseBody(HealthLiveResponse, res)).resolves.toEqual({ ok: true })
  })

  it('GET /health/ready and /health return 200 when the database check succeeds', async () => {
    const res = await webHandler.handler(new Request('http://localhost/health/ready'))
    const checkRes = await webHandler.handler(new Request('http://localhost/health'))

    expect(res.status).toBe(200)
    expect(checkRes.status).toBe(200)
    await expect(decodeResponseBody(HealthReadyResponse, res)).resolves.toEqual({
      dbConnected: true,
    })
    await expect(decodeResponseBody(HealthReadyResponse, checkRes)).resolves.toEqual({
      dbConnected: true,
    })
  })

  it('responds 404 to unsupported methods on health paths', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/health/live', { method: 'POST' }),
    )

    expect(res.status).toBe(404)
  })
})

describe('music artists (HttpApiBuilder group, Step 4)', () => {
  it('GET /api/music/artists returns 200 with a decodable list', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/music/artists'))

    expect(res.status).toBe(200)
    await expect(decodeResponseBody(ArtistListResponse, res)).resolves.toBeInstanceOf(Array)
  })

  it('GET /api/music/artists/:id returns 404 for an unknown id', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/artists/00000000-0000-0000-0000-000000000000'),
    )

    expect(res.status).toBe(404)
  })

  it('POST /api/music/artists returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/artists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Test Artist', slug: 'test-artist' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('PATCH /api/music/artists/:id returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/artists/00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/music/artists/:id returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/artists/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(401)
  })

  it('PUT /api/music/albums/:albumId/artists/:artistId returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request(
        'http://localhost/api/music/albums/00000000-0000-0000-0000-000000000000/artists/00000000-0000-0000-0000-000000000000',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      ),
    )

    expect(res.status).toBe(401)
  })

  it('requires authentication to read and change label affiliations', async () => {
    const id = '00000000-0000-0000-0000-000000000000'

    const requests = [
      new Request(`http://localhost/api/music/labels/${id}/artists`),
      new Request(`http://localhost/api/music/labels/${id}/albums`),
      new Request(`http://localhost/api/music/artists/${id}/labels`),
      new Request(`http://localhost/api/music/albums/${id}/labels`),
      new Request(`http://localhost/api/music/labels/${id}/artists/${id}`, { method: 'PUT' }),
      new Request(`http://localhost/api/music/labels/${id}/albums/${id}`, { method: 'PUT' }),
    ]

    const responses = await Promise.all(requests.map((request) => webHandler.handler(request)))

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401])
  })
})

describe('music labels', () => {
  it('returns a decodable public label list', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/music/labels'))

    expect(res.status).toBe(200)
    await expect(decodeResponseBody(LabelListResponse, res)).resolves.toBeInstanceOf(Array)
  })

  it('returns 404 for an unknown public label slug', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/labels/slug/unknown-label'),
    )

    expect(res.status).toBe(404)
  })

  it('requires authentication for managed labels', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/music/labels/manage'))

    expect(res.status).toBe(401)
  })

  it('manages factual affiliations reciprocally while publishing only visible entities', async () => {
    const suffix = crypto.randomUUID()
    const adminId = `affiliation-admin-${suffix}`
    const adminToken = `affiliation-admin-token-${suffix}`
    const now = new Date()
    const future = new Date(now.getTime() + 86_400_000)

    await db.insert(user).values({
      id: adminId,
      name: 'Affiliation admin',
      email: `${adminId}@example.com`,
      role: 'admin',
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token: adminToken,
      userId: adminId,
      expiresAt: new Date(now.getTime() + 60_000),
    })

    const [label] = await db
      .insert(musicLabelsTable)
      .values({
        name: 'Affiliation label',
        slug: `affiliation-label-${suffix}`,
        content: '',
        publishedAt: now,
      })
      .returning()

    const [publishedArtist, draftArtist] = await db
      .insert(musicArtistsTable)
      .values([
        { name: 'Alpha Artist', slug: `alpha-artist-${suffix}`, publishedAt: now },
        { name: 'Draft Artist', slug: `draft-artist-${suffix}` },
      ])
      .returning()

    const [publishedAlbum, futureAlbum] = await db
      .insert(musicAlbumsTable)
      .values([
        {
          title: 'Published Album',
          slug: `published-album-${suffix}`,
          releaseDate: now,
          publishedAt: now,
        },
        {
          title: 'Future Album',
          slug: `future-album-${suffix}`,
          releaseDate: future,
          publishedAt: future,
        },
      ])
      .returning()

    if (!label || !publishedArtist || !draftArtist || !publishedAlbum || !futureAlbum) {
      throw new Error('Failed to seed label affiliation test')
    }

    const adminRequest = (path: string, method = 'GET') =>
      new Request(`http://localhost${path}`, {
        method,
        headers: { authorization: `Bearer ${adminToken}` },
      })

    const publishedArtistPath = `/api/music/labels/${label.id}/artists/${publishedArtist.id}`
    const draftArtistPath = `/api/music/labels/${label.id}/artists/${draftArtist.id}`
    const publishedAlbumPath = `/api/music/labels/${label.id}/albums/${publishedAlbum.id}`
    const futureAlbumPath = `/api/music/labels/${label.id}/albums/${futureAlbum.id}`

    try {
      const writes = await Promise.all(
        [
          publishedArtistPath,
          draftArtistPath,
          publishedAlbumPath,
          futureAlbumPath,
          publishedArtistPath,
          publishedAlbumPath,
        ].map((path) => webHandler.handler(adminRequest(path, 'PUT'))),
      )

      expect(writes.map((response) => response.status)).toEqual([204, 204, 204, 204, 204, 204])

      const [labelArtists, labelAlbums, artistLabels, albumLabels, publicLabel] = await Promise.all(
        [
          webHandler.handler(adminRequest(`/api/music/labels/${label.id}/artists`)),
          webHandler.handler(adminRequest(`/api/music/labels/${label.id}/albums`)),
          webHandler.handler(adminRequest(`/api/music/artists/${publishedArtist.id}/labels`)),
          webHandler.handler(adminRequest(`/api/music/albums/${publishedAlbum.id}/labels`)),
          webHandler.handler(new Request(`http://localhost/api/music/labels/slug/${label.slug}`)),
        ],
      )

      expect(labelArtists.status).toBe(200)
      expect(labelAlbums.status).toBe(200)
      expect(artistLabels.status).toBe(200)
      expect(albumLabels.status).toBe(200)
      const labelArtistsBody = await decodeResponseBody(ArtistListResponse, labelArtists)
      const labelAlbumsBody = await decodeResponseBody(AlbumListResponse, labelAlbums)
      const artistLabelsBody = await decodeResponseBody(LabelListResponse, artistLabels)
      const albumLabelsBody = await decodeResponseBody(LabelListResponse, albumLabels)
      expect(labelArtistsBody.map((artist) => artist.name)).toEqual([
        'Alpha Artist',
        'Draft Artist',
      ])
      expect(labelAlbumsBody.map((album) => album.title)).toEqual([
        'Future Album',
        'Published Album',
      ])
      expect(artistLabelsBody.map((row) => row.id)).toEqual([label.id])
      expect(albumLabelsBody.map((row) => row.id)).toEqual([label.id])

      const publicBody = await decodeResponseBody(LabelResponse, publicLabel)
      expect(publicBody.affiliatedArtists?.map((artist) => artist.id)).toEqual([publishedArtist.id])
      expect(publicBody.affiliatedAlbums?.map((album) => album.id)).toEqual([publishedAlbum.id])

      const removed = await webHandler.handler(adminRequest(publishedArtistPath, 'DELETE'))

      const afterRemove = await webHandler.handler(
        adminRequest(`/api/music/artists/${publishedArtist.id}/labels`),
      )

      expect(removed.status).toBe(204)
      await expect(decodeResponseBody(LabelListResponse, afterRemove)).resolves.toEqual([])
    } finally {
      await db.delete(musicLabelArtistsTable).where(eq(musicLabelArtistsTable.labelId, label.id))
      await db.delete(musicLabelAlbumsTable).where(eq(musicLabelAlbumsTable.labelId, label.id))
      await db.delete(musicAlbumsTable).where(eq(musicAlbumsTable.id, publishedAlbum.id))
      await db.delete(musicAlbumsTable).where(eq(musicAlbumsTable.id, futureAlbum.id))
      await db.delete(musicArtistsTable).where(eq(musicArtistsTable.id, publishedArtist.id))
      await db.delete(musicArtistsTable).where(eq(musicArtistsTable.id, draftArtist.id))
      await db.delete(musicLabelsTable).where(eq(musicLabelsTable.id, label.id))
      await db.delete(user).where(eq(user.id, adminId))
    }
  })
})

// Regression test for the gap documented in docs/migration-effect-http-api.md
// and docs/migration-effect-http-api-process.md: commit d052ce82 ("port
// search to HttpApiBuilder.group, Step 6") deleted the entire routes/music/*
// Hono directory -- including fully-implemented album/track/playlist/
// entity-link handlers -- claiming (incorrectly) they were dead code already
// superseded by http/music.handlers.ts. That left /api/music/albums and
// friends 404ing in production. This block proves the port is real.
describe('music albums/tracks/playlists (HttpApiBuilder group, Step 6c)', () => {
  it('GET /api/music/albums returns 200 with a decodable list', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/music/albums'))

    expect(res.status).toBe(200)
    await expect(decodeResponseBody(AlbumListResponse, res)).resolves.toBeInstanceOf(Array)
  })

  it('GET /api/music/albums/:id returns 404 for an unknown id', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/albums/00000000-0000-0000-0000-000000000000'),
    )

    expect(res.status).toBe(404)
  })

  it('POST /api/music/albums returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/albums', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Test Album', slug: 'test-album' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('PATCH /api/music/albums/:id returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/albums/00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/music/albums/:id returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/albums/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(401)
  })

  it('GET /api/music/tracks returns 200 with a decodable list', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/music/tracks'))

    expect(res.status).toBe(200)
    await expect(decodeResponseBody(TrackListResponse, res)).resolves.toBeInstanceOf(Array)
  })

  it('GET /api/music/tracks/:id returns 404 for an unknown id', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/tracks/00000000-0000-0000-0000-000000000000'),
    )

    expect(res.status).toBe(404)
  })

  it('POST /api/music/tracks returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/tracks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Test Track', slug: 'test-track' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/music/tracks/:id returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/tracks/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(401)
  })

  it('GET /api/music/playlists returns 200 with a decodable list', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/music/playlists'))

    expect(res.status).toBe(200)
    await expect(decodeResponseBody(PlaylistListResponse, res)).resolves.toBeInstanceOf(Array)
  })

  it('GET /api/music/playlists/:id returns 404 for an unknown id', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/playlists/00000000-0000-0000-0000-000000000000'),
    )

    expect(res.status).toBe(404)
  })

  it('GET /api/music/playlists/:id/tracks returns 401-free 200 (public read) with an empty list for an unknown playlist', async () => {
    const res = await webHandler.handler(
      new Request(
        'http://localhost/api/music/playlists/00000000-0000-0000-0000-000000000000/tracks',
      ),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual([])
  })

  it('POST /api/music/playlists/:id/tracks returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request(
        'http://localhost/api/music/playlists/00000000-0000-0000-0000-000000000000/tracks',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ trackId: '00000000-0000-0000-0000-000000000000', position: 0 }),
        },
      ),
    )

    expect(res.status).toBe(401)
  })

  it('PUT /api/music/playlists/:id/tracks/order returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request(
        'http://localhost/api/music/playlists/00000000-0000-0000-0000-000000000000/tracks/order',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ trackIds: ['00000000-0000-0000-0000-000000000000'] }),
        },
      ),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/music/playlists/import/spotify returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/playlists/import/spotify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://open.spotify.com/playlist/abc' }),
      }),
    )

    expect(res.status).toBe(401)
  })
})

describe('music entity-links/resolve/scrape (HttpApiBuilder group, Step 6d)', () => {
  it('GET /api/music/artist/:id/links returns 200 with a decodable (empty) list for an unknown entity', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/artist/00000000-0000-0000-0000-000000000000/links'),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual([])
  })

  it('GET /api/music/:entityType/:entityId/links 400s for an invalid entityType (schema-level rejection)', async () => {
    const res = await webHandler.handler(
      new Request(
        'http://localhost/api/music/not-a-real-type/00000000-0000-0000-0000-000000000000/links',
      ),
    )

    expect(res.status).toBe(400)
  })

  it('POST /api/music/artist/:id/links returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/artist/00000000-0000-0000-0000-000000000000/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'spotify', url: 'https://open.spotify.com/artist/x' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('PATCH /api/music/artist/:id/links/:linkId returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request(
        'http://localhost/api/music/artist/00000000-0000-0000-0000-000000000000/links/00000000-0000-0000-0000-000000000000',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'verified' }),
        },
      ),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/music/artist/:id/links/:linkId returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request(
        'http://localhost/api/music/artist/00000000-0000-0000-0000-000000000000/links/00000000-0000-0000-0000-000000000000',
        { method: 'DELETE' },
      ),
    )

    expect(res.status).toBe(401)
  })

  it('preserves display platforms and retains the legacy album YouTube flow', async () => {
    const suffix = crypto.randomUUID()
    const userId = `link-admin-${suffix}`
    const token = `link-admin-token-${suffix}`
    const albumId = crypto.randomUUID()
    const trackId = crypto.randomUUID()
    const videoId = suffix.replaceAll('-', '')

    const canonicalLinks = [
      {
        entityType: 'album',
        entityId: albumId,
        platform: 'discogs',
        url: `https://www.discogs.com/release/${suffix}`,
      },
      {
        entityType: 'album',
        entityId: albumId,
        platform: 'website',
        url: `https://artist-${suffix}.example.com/album`,
      },
      {
        entityType: 'track',
        entityId: trackId,
        platform: 'youtube_music',
        url: `https://music.youtube.com/watch?v=${videoId}`,
      },
    ] as const

    const legacyLink = {
      platform: 'youtube',
      url: `https://www.youtube.com/watch?v=legacy${videoId}`,
    } as const

    await db.batch([
      db.insert(user).values({
        id: userId,
        name: 'Link admin',
        email: `${userId}@example.com`,
        role: 'admin',
      }),
      db.insert(session).values({
        id: crypto.randomUUID(),
        token,
        userId,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      db
        .insert(musicEntityTypesTable)
        .values([
          { id: 'album', displayName: 'Album' },
          { id: 'track', displayName: 'Track' },
        ])
        .onConflictDoNothing(),
      db
        .insert(musicPlatformsTable)
        .values(
          ['discogs', 'website', 'youtube_music', 'youtube', 'other'].map((platform) => ({
            id: platform,
            displayName: platform,
          })),
        )
        .onConflictDoNothing(),
      db
        .insert(musicAlbumsTable)
        .values({ id: albumId, title: 'Link compatibility album', slug: `links-${suffix}` }),
      db
        .insert(musicTracksTable)
        .values({ id: trackId, title: 'Link compatibility track', slug: `track-links-${suffix}` }),
    ])

    const request = (
      path: string,
      method: 'POST' | 'PATCH',
      body:
        | {
            readonly platform: string
            readonly url: string
            readonly status: 'rejected'
          }
        | {
            readonly status: 'verified'
            readonly metadata?: { readonly reviewNote: string }
          },
    ) =>
      webHandler.handler(
        new Request(`http://localhost${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )

    try {
      await Promise.all(
        canonicalLinks.map(async (link) => {
          const path = `/api/music/${link.entityType}/${link.entityId}/links`

          const added = await request(path, 'POST', {
            platform: link.platform,
            url: link.url,
            status: 'rejected',
          })

          expect(added.status).toBe(200)
          const addedLink = await decodeResponseBody(EntityLinkResponse, added)
          expect(addedLink).toMatchObject({
            platform: link.platform,
            url: link.url,
            status: 'rejected',
          })

          const verified = await request(`${path}/${addedLink.id}`, 'PATCH', {
            status: 'verified',
            metadata: { reviewNote: 'approved' },
          })

          expect(verified.status).toBe(200)
          await expect(decodeResponseBody(EntityLinkResponse, verified)).resolves.toMatchObject({
            platform: link.platform,
            url: link.url,
            status: 'verified',
            verifiedBy: userId,
            metadata: {
              discoveredBy: 'manual',
              confidence: 'exact_source',
              reviewNote: 'approved',
            },
          })
        }),
      )

      const legacyAdded = await request(`/api/music/album/${albumId}/links`, 'POST', {
        ...legacyLink,
        status: 'rejected',
      })

      expect(legacyAdded.status).toBe(200)
      const legacyAddedLink = await decodeResponseBody(EntityLinkResponse, legacyAdded)

      const legacyVerified = await request(
        `/api/music/album/${albumId}/links/${legacyAddedLink.id}`,
        'PATCH',
        { status: 'verified' },
      )

      expect(legacyVerified.status).toBe(200)
      await expect(decodeResponseBody(EntityLinkResponse, legacyVerified)).resolves.toMatchObject({
        ...legacyLink,
        status: 'verified',
        verifiedBy: userId,
      })

      const identities = await db.select().from(musicSourceIdentitiesTable)

      const ownedIdentities = identities.filter(
        ({ entityId }) => entityId === albumId || entityId === trackId,
      )

      expect(ownedIdentities).toHaveLength(3)
      expect(ownedIdentities.map(({ platform }) => platform).sort()).toEqual([
        'other',
        'other',
        'youtube',
      ])
      expect(ownedIdentities).toContainEqual(
        expect.objectContaining({
          sourceKey: `youtube:video:${videoId}`,
          entityType: 'track',
          entityId: trackId,
        }),
      )
      expect(
        ownedIdentities.some(({ sourceKey }) => sourceKey === `youtube:video:legacy${videoId}`),
      ).toBe(false)
    } finally {
      await db
        .delete(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.entityId, albumId))
      await db
        .delete(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.entityId, trackId))
      await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, albumId))
      await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, trackId))
      await db.delete(musicTracksTable).where(eq(musicTracksTable.id, trackId))
      await db.delete(musicAlbumsTable).where(eq(musicAlbumsTable.id, albumId))
      await db.delete(session).where(eq(session.userId, userId))
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('releases a reverified YouTube Music identity after review metadata is added', async () => {
    const suffix = crypto.randomUUID()
    const userId = `reverify-admin-${suffix}`
    const token = `reverify-admin-token-${suffix}`
    const incumbentId = crypto.randomUUID()
    const candidateId = crypto.randomUUID()
    const videoId = `reverify${suffix.replaceAll('-', '')}`
    const youtubeMusicUrl = `https://music.youtube.com/watch?v=${videoId}`
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`
    const sourceKey = `youtube:video:${videoId}`

    await db.batch([
      db.insert(user).values({
        id: userId,
        name: 'Reverify admin',
        email: `${userId}@example.com`,
        role: 'admin',
      }),
      db.insert(session).values({
        id: crypto.randomUUID(),
        token,
        userId,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      db
        .insert(musicEntityTypesTable)
        .values({ id: 'track', displayName: 'Track' })
        .onConflictDoNothing(),
      db
        .insert(musicPlatformsTable)
        .values(
          ['youtube_music', 'youtube'].map((platform) => ({
            id: platform,
            displayName: platform,
          })),
        )
        .onConflictDoNothing(),
      db.insert(musicTracksTable).values([
        { id: incumbentId, title: 'Reverified incumbent', slug: `reverified-${suffix}` },
        { id: candidateId, title: 'Reverified candidate', slug: `candidate-${suffix}` },
      ]),
    ])

    const request = (
      path: string,
      method: 'POST' | 'PATCH' | 'DELETE',
      body?:
        | {
            readonly platform: 'youtube_music' | 'youtube'
            readonly url: string
            readonly status?: 'rejected'
          }
        | {
            readonly status: 'verified'
            readonly metadata: { readonly reviewNote: string }
          },
    ) => {
      const headers = new Headers({ authorization: `Bearer ${token}` })

      if (body) headers.set('content-type', 'application/json')

      return webHandler.handler(
        new Request(
          `http://localhost${path}`,
          omitUndefined({
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          }),
        ),
      )
    }

    try {
      const incumbentPath = `/api/music/track/${incumbentId}/links`

      const added = await request(incumbentPath, 'POST', {
        platform: 'youtube_music',
        url: youtubeMusicUrl,
        status: 'rejected',
      })

      expect(added.status).toBe(200)
      const addedLink = await decodeResponseBody(EntityLinkResponse, added)

      const linkPath = `${incumbentPath}/${addedLink.id}`

      const verified = await request(linkPath, 'PATCH', {
        status: 'verified',
        metadata: { reviewNote: 'approved' },
      })

      expect(verified.status).toBe(200)
      const verifiedLink = await decodeResponseBody(EntityLinkResponse, verified)

      const deleted = await request(linkPath, 'DELETE')
      expect(deleted.status).toBe(204)

      const attached = await request(`/api/music/track/${candidateId}/links`, 'POST', {
        platform: 'youtube',
        url: youtubeUrl,
      })

      expect(attached.status).toBe(200)
      const attachedLink = await decodeResponseBody(EntityLinkResponse, attached)

      const identities = await db
        .select()
        .from(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.sourceKey, sourceKey))

      const aliases = await db
        .select()
        .from(musicSourceAliasesTable)
        .where(eq(musicSourceAliasesTable.sourceKey, sourceKey))

      expect(verifiedLink.metadata).toMatchObject({
        discoveredBy: 'manual',
        confidence: 'exact_source',
        reviewNote: 'approved',
      })
      expect(attachedLink).toMatchObject({
        entityId: candidateId,
        platform: 'youtube',
        url: youtubeUrl,
        status: 'verified',
      })
      expect(identities).toEqual([
        expect.objectContaining({
          sourceKey,
          platform: 'youtube',
          entityType: 'track',
          entityId: candidateId,
        }),
      ])
      expect(aliases).toEqual([
        expect.objectContaining({
          normalizedUrl: youtubeUrl,
          sourceKey,
        }),
      ])
    } finally {
      await db
        .delete(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.entityId, incumbentId))
      await db
        .delete(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.entityId, candidateId))
      await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, incumbentId))
      await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, candidateId))
      await db.delete(musicTracksTable).where(eq(musicTracksTable.id, incumbentId))
      await db.delete(musicTracksTable).where(eq(musicTracksTable.id, candidateId))
      await db.delete(session).where(eq(session.userId, userId))
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('blocks mislabeled Spotify and cross-label generic and YouTube collisions', async () => {
    const suffix = crypto.randomUUID()
    const userId = `collision-admin-${suffix}`
    const token = `collision-admin-token-${suffix}`
    const incumbentId = crypto.randomUUID()
    const candidateId = crypto.randomUUID()
    const spotifyId = suffix.replaceAll('-', '')
    const youtubeId = `yt${spotifyId}`
    const spotifyUrl = `https://open.spotify.com/track/${spotifyId}`
    const genericUrl = `https://catalog-${suffix}.example.com/release?edition=deluxe`
    const youtubeMusicUrl = `https://music.youtube.com/watch?v=${youtubeId}`

    await db.batch([
      db.insert(user).values({
        id: userId,
        name: 'Collision admin',
        email: `${userId}@example.com`,
        role: 'admin',
      }),
      db.insert(session).values({
        id: crypto.randomUUID(),
        token,
        userId,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      db
        .insert(musicEntityTypesTable)
        .values({ id: 'track', displayName: 'Track' })
        .onConflictDoNothing(),
      db
        .insert(musicPlatformsTable)
        .values(
          ['spotify', 'website', 'discogs', 'youtube_music', 'youtube', 'other'].map(
            (platform) => ({ id: platform, displayName: platform }),
          ),
        )
        .onConflictDoNothing(),
      db.insert(musicTracksTable).values([
        { id: incumbentId, title: 'Identity incumbent', slug: `incumbent-${suffix}` },
        { id: candidateId, title: 'Identity candidate', slug: `candidate-${suffix}` },
      ]),
    ])

    const addLink = (entityId: string, link: Readonly<{ platform: string; url: string }>) =>
      webHandler.handler(
        new Request(`http://localhost/api/music/track/${entityId}/links`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(link),
        }),
      )

    try {
      const spotifyAttached = await addLink(incumbentId, {
        platform: 'spotify',
        url: spotifyUrl,
      })

      expect(spotifyAttached.status).toBe(200)

      const mislabeledSpotify = await addLink(candidateId, {
        platform: 'website',
        url: spotifyUrl,
      })

      expect(mislabeledSpotify.status).toBe(400)

      const wrongSpotifyEntityType = await addLink(candidateId, {
        platform: 'spotify',
        url: `https://open.spotify.com/album/${spotifyId}`,
      })

      expect(wrongSpotifyEntityType.status).toBe(400)

      const genericAttached = await addLink(incumbentId, {
        platform: 'website',
        url: genericUrl,
      })

      expect(genericAttached.status).toBe(200)
      await expect(decodeResponseBody(EntityLinkResponse, genericAttached)).resolves.toMatchObject({
        platform: 'website',
        url: genericUrl,
      })

      const genericCollision = await addLink(candidateId, {
        platform: 'discogs',
        url: genericUrl,
      })

      expect(genericCollision.status).toBe(409)

      const youtubeMusicAttached = await addLink(incumbentId, {
        platform: 'youtube_music',
        url: youtubeMusicUrl,
      })

      expect(youtubeMusicAttached.status).toBe(200)
      await expect(
        decodeResponseBody(EntityLinkResponse, youtubeMusicAttached),
      ).resolves.toMatchObject({
        platform: 'youtube_music',
        url: youtubeMusicUrl,
      })

      const youtubeCollision = await addLink(candidateId, {
        platform: 'youtube',
        url: youtubeMusicUrl,
      })

      expect(youtubeCollision.status).toBe(409)

      const identities = await db
        .select()
        .from(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.entityId, incumbentId))

      const incumbentLinks = await db
        .select()
        .from(musicEntityLinksTable)
        .where(eq(musicEntityLinksTable.entityId, incumbentId))

      const candidateLinks = await db
        .select()
        .from(musicEntityLinksTable)
        .where(eq(musicEntityLinksTable.entityId, candidateId))

      expect(new Set(identities.map(({ platform }) => platform))).toEqual(
        new Set(['spotify', 'other', 'youtube']),
      )
      expect(identities).toContainEqual(
        expect.objectContaining({
          sourceKey: `youtube:video:${youtubeId}`,
          platform: 'youtube',
          entityId: incumbentId,
        }),
      )
      expect(new Set(incumbentLinks.map(({ platform }) => platform))).toEqual(
        new Set(['spotify', 'website', 'youtube_music']),
      )
      expect(candidateLinks).toHaveLength(0)
    } finally {
      await db
        .delete(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.entityId, incumbentId))
      await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, incumbentId))
      await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, candidateId))
      await db.delete(musicTracksTable).where(eq(musicTracksTable.id, incumbentId))
      await db.delete(musicTracksTable).where(eq(musicTracksTable.id, candidateId))
      await db.delete(session).where(eq(session.userId, userId))
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('POST /api/music/resolve returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://open.spotify.com/track/abc' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/music/resolve returns 401 (not 400) for a non-URL body without a session -- AuthMiddleware runs before payload schema validation', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-url' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/music/resolve returns 503 when exact source resolution is unavailable', async () => {
    const suffix = crypto.randomUUID()
    const userId = `resolve-admin-${suffix}`
    const token = `resolve-admin-token-${suffix}`

    await db.insert(user).values({
      id: userId,
      name: 'Admin user',
      email: `${userId}@example.com`,
      role: 'admin',
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db.batch([
      db
        .insert(musicEntityTypesTable)
        .values({ id: 'track', displayName: 'Track' })
        .onConflictDoNothing(),
      db
        .insert(musicPlatformsTable)
        .values({ id: 'spotify', displayName: 'Spotify' })
        .onConflictDoNothing(),
    ])

    try {
      const res = await webHandler.handler(
        new Request('http://localhost/api/music/resolve', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ url: 'https://open.spotify.com/track/0000000000000000000000' }),
        }),
      )

      expect(res.status).toBe(503)
    } finally {
      await db.delete(session).where(eq(session.userId, userId))
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('POST music resolve callers reuse an inferred artist identity without provider access', async () => {
    const suffix = crypto.randomUUID()
    const userId = `resolve-hit-admin-${suffix}`
    const token = `resolve-hit-token-${suffix}`
    const artistId = crypto.randomUUID()
    const spotifyArtistId = '4iV5W9uYEdYUVa79Axb7Rh'
    const url = `https://open.spotify.com/artist/${spotifyArtistId}`
    const sourceKey = `spotify:artist:${spotifyArtistId}`

    await db.batch([
      db.insert(user).values({
        id: userId,
        name: 'Admin user',
        email: `${userId}@example.com`,
        role: 'admin',
      }),
      db.insert(session).values({
        id: crypto.randomUUID(),
        token,
        userId,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      db
        .insert(musicEntityTypesTable)
        .values({ id: 'artist', displayName: 'Artist' })
        .onConflictDoNothing(),
      db
        .insert(musicPlatformsTable)
        .values({ id: 'spotify', displayName: 'Spotify' })
        .onConflictDoNothing(),
      db
        .insert(musicArtistsTable)
        .values({ id: artistId, name: 'Known artist', slug: `known-${suffix}` }),
      db.insert(musicEntityLinksTable).values({
        entityType: 'artist',
        entityId: artistId,
        platform: 'spotify',
        url,
        status: 'verified',
        metadata: { confidence: 'exact_source' },
      }),
      db.insert(musicSourceIdentitiesTable).values({
        sourceKey,
        platform: 'spotify',
        sourceEntityType: 'artist',
        externalId: spotifyArtistId,
        canonicalUrl: url,
        state: 'resolved',
        entityType: 'artist',
        entityId: artistId,
        resolvedAt: new Date(),
      }),
      db.insert(musicSourceAliasesTable).values({
        normalizedUrl: url,
        sourceKey,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      }),
    ])

    try {
      const request = (path: string) =>
        webHandler.handler(
          new Request(`http://localhost${path}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ url }),
          }),
        )

      const [resolve, scrape] = await Promise.all([
        request('/api/music/resolve'),
        request('/api/music/artist/scrape'),
      ])

      expect(resolve.status).toBe(200)
      expect(scrape.status).toBe(200)
      const resolveBody = await decodeResponseBody(ResolvedMusicEntityResponse, resolve)
      const scrapeBody = await decodeResponseBody(ScrapeEntityLinksResponse, scrape)
      expect(resolveBody.entityType).toBe('artist')
      expect(resolveBody.entity.id).toBe(artistId)
      expect(scrapeBody.entity.id).toBe(artistId)
    } finally {
      await db
        .delete(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.sourceKey, sourceKey))
      await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, artistId))
      await db.delete(musicArtistsTable).where(eq(musicArtistsTable.id, artistId))
      await db.delete(session).where(eq(session.userId, userId))
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('POST /api/music/resolve returns copied artist artwork in imageUrl without coverImageUrl', async () => {
    const suffix = crypto.randomUUID()
    const userId = `resolve-artwork-admin-${suffix}`
    const token = `resolve-artwork-token-${suffix}`
    const artistId = crypto.randomUUID()
    const spotifyArtistId = '5K4W6rqBFWDnAN6FQUkS6x'
    const url = `https://open.spotify.com/artist/${spotifyArtistId}`
    const sourceKey = `spotify:artist:${spotifyArtistId}`
    const imageUrl = 'https://i.scdn.co/image/provider-artwork'
    const copiedImageUrl = `https://cdn.goosebumps.fm/user-content/music/artist/${artistId}/cover`

    await db.batch([
      db.insert(user).values({
        id: userId,
        name: 'Admin user',
        email: `${userId}@example.com`,
        role: 'admin',
      }),
      db.insert(session).values({
        id: crypto.randomUUID(),
        token,
        userId,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      db
        .insert(musicEntityTypesTable)
        .values({ id: 'artist', displayName: 'Artist' })
        .onConflictDoNothing(),
      db
        .insert(musicPlatformsTable)
        .values({ id: 'spotify', displayName: 'Spotify' })
        .onConflictDoNothing(),
      db.insert(musicArtistsTable).values({
        id: artistId,
        name: 'Artwork artist',
        imageUrl,
        slug: `artwork-${suffix}`,
      }),
      db.insert(musicEntityLinksTable).values({
        entityType: 'artist',
        entityId: artistId,
        platform: 'spotify',
        url,
        status: 'verified',
        metadata: { confidence: 'exact_source' },
      }),
      db.insert(musicSourceIdentitiesTable).values({
        sourceKey,
        platform: 'spotify',
        sourceEntityType: 'artist',
        externalId: spotifyArtistId,
        canonicalUrl: url,
        state: 'resolved',
        entityType: 'artist',
        entityId: artistId,
        resolvedAt: new Date(),
      }),
      db.insert(musicSourceAliasesTable).values({
        normalizedUrl: url,
        sourceKey,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      }),
    ])

    const artworkFetchLayer = Layer.succeed(MusicCoverImageFetcher, () =>
      Promise.resolve(
        new Response('image-bytes', {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    )

    const artworkHandler = createTestWebHandler(
      d1,
      undefined,
      writableObjectStoreLayer,
      artworkFetchLayer,
    )

    try {
      const response = await artworkHandler.handler(
        new Request('http://localhost/api/music/resolve', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        }),
      )

      expect(response.status).toBe(200)
      const body = await decodeResponseBody(ResolvedMusicEntityResponse, response)
      expect(body.entityType).toBe('artist')

      if (body.entityType !== 'artist') throw new Error('Expected resolved artist response')
      expect(body.coverImageUrl).toBe(copiedImageUrl)
      expect(body.entity.imageUrl).toBe(copiedImageUrl)
      expect(body.entity).not.toHaveProperty('coverImageUrl')
    } finally {
      await artworkHandler.dispose()
      await db
        .delete(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.sourceKey, sourceKey))
      await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, artistId))
      await db.delete(musicArtistsTable).where(eq(musicArtistsTable.id, artistId))
      await db.delete(session).where(eq(session.userId, userId))
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('POST /api/music resolve endpoints return 503 while a claim lease is active', async () => {
    const suffix = crypto.randomUUID()
    const userId = `resolve-unavailable-admin-${suffix}`
    const token = `resolve-unavailable-admin-token-${suffix}`
    const spotifyTrackId = '1234567890123456789012'
    const url = `https://open.spotify.com/track/${spotifyTrackId}`

    await db.insert(user).values({
      id: userId,
      name: 'Admin user',
      email: `${userId}@example.com`,
      role: 'admin',
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db.batch([
      db
        .insert(musicEntityTypesTable)
        .values({ id: 'track', displayName: 'Track' })
        .onConflictDoNothing(),
      db
        .insert(musicPlatformsTable)
        .values({ id: 'spotify', displayName: 'Spotify' })
        .onConflictDoNothing(),
    ])
    await db.insert(musicSourceIdentitiesTable).values({
      sourceKey: `spotify:track:${spotifyTrackId}`,
      platform: 'spotify',
      sourceEntityType: 'track',
      externalId: spotifyTrackId,
      canonicalUrl: url,
      state: 'resolving',
      ownerToken: crypto.randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })

    try {
      const request = (path: string) =>
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        })

      const [resolve, scrape] = await Promise.all([
        webHandler.handler(request('/api/music/resolve')),
        webHandler.handler(request('/api/music/track/scrape')),
      ])

      expect(resolve.status).toBe(503)
      expect(Number(resolve.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(Number(resolve.headers.get('retry-after'))).toBeLessThanOrEqual(60)
      expect(scrape.status).toBe(503)
      expect(Number(scrape.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(Number(scrape.headers.get('retry-after'))).toBeLessThanOrEqual(60)
    } finally {
      await db
        .delete(musicSourceIdentitiesTable)
        .where(eq(musicSourceIdentitiesTable.canonicalUrl, url))
      await db.delete(session).where(eq(session.userId, userId))
      await db.delete(user).where(eq(user.id, userId))
    }
  }, 20_000)

  it('POST /api/music/artist/scrape returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music/artist/scrape', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artistName: 'Test Artist' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/music/track/:id/links/rescrape returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request(
        'http://localhost/api/music/track/00000000-0000-0000-0000-000000000000/links/rescrape',
        { method: 'POST' },
      ),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/music/track/:id/links/rescrape returns 404 when no Spotify source link exists', async () => {
    const suffix = crypto.randomUUID()
    const userId = `rescrape-admin-${suffix}`
    const token = `rescrape-admin-token-${suffix}`
    const trackId = crypto.randomUUID()

    await db.insert(user).values({
      id: userId,
      name: 'Admin user',
      email: `${userId}@example.com`,
      role: 'admin',
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db.insert(musicTracksTable).values({
      id: trackId,
      title: 'Track without Spotify',
      slug: `track-without-spotify-${suffix}`,
    })

    try {
      const res = await webHandler.handler(
        new Request(`http://localhost/api/music/track/${trackId}/links/rescrape`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        }),
      )

      expect(res.status).toBe(404)
    } finally {
      await db.delete(musicTracksTable).where(eq(musicTracksTable.id, trackId))
      await db.delete(session).where(eq(session.userId, userId))
      await db.delete(user).where(eq(user.id, userId))
    }
  })
})

describe('search (HttpApiBuilder group, Step 6)', () => {
  it('GET /api/search?q=test returns 200 with a decodable grouped result', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/search?q=test'))

    expect(res.status).toBe(200)
    // A successful decode against SearchResults already proves shows/audio/posts
    // exist and are arrays -- asserting field-by-field on top of that would just
    // re-check what decode already guarantees.
    await expect(decodeResponseBody(SearchResults, res)).resolves.toBeTruthy()
  })

  it('GET /api/search?q=test sets a public Cache-Control header', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/search?q=test'))

    expect(res.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300')
  })

  it('GET /api/search without q returns 400 (query validation failure)', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/search'))

    expect(res.status).toBe(400)
  })

  it('GET /api/search?q=test&limit=999 returns 400 (limit above the 50 max)', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/search?q=test&limit=999'),
    )

    expect(res.status).toBe(400)
  })

  it('other paths do not get the search Cache-Control header', async () => {
    const res = await webHandler.handler(new Request('http://localhost/health/live'))

    expect(res.headers.get('cache-control')).toBeNull()
  })
})

describe('profile (HttpApiBuilder group, Step 6)', () => {
  it('GET /api/profile/:username returns 404 for an unknown username', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/profile/does-not-exist-user'),
    )

    expect(res.status).toBe(404)
  })

  it('responds 404 to unsupported methods on the profile path', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/profile/does-not-exist-user', { method: 'POST' }),
    )

    expect(res.status).toBe(404)
  })
})

describe('resolve (HttpApiBuilder group, Step 6)', () => {
  it('GET /api/resolve/:slug returns 404 for an unknown slug', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/resolve/does-not-exist-slug'),
    )

    expect(res.status).toBe(404)
  })

  it('GET /api/resolve/:slug returns 404 for a reserved slug', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/resolve/api'))

    expect(res.status).toBe(404)
  })

  it('responds 404 to unsupported methods on the resolve path', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/resolve/does-not-exist-slug', { method: 'POST' }),
    )

    expect(res.status).toBe(404)
  })
})

describe('admin (HttpApiBuilder group, Step 6)', () => {
  it('GET /api/admin/overview returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/admin/overview'))

    expect(res.status).toBe(401)
  })

  it('GET /api/admin/newsletter-subscribers returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/admin/newsletter-subscribers'),
    )

    expect(res.status).toBe(401)
  })

  it('GET /api/admin/telemetry returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/admin/telemetry'))

    expect(res.status).toBe(401)
  })

  it('GET /api/admin/frontend-errors/:scenario returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/admin/frontend-errors/ok'),
    )

    expect(res.status).toBe(401)
  })

  it('GET /api/admin/frontend-errors/:scenario returns 401 (not 400) for an undeclared scenario literal without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/admin/frontend-errors/not-a-real-scenario'),
    )

    // AuthMiddleware runs before param schema validation, so an invalid
    // :scenario value still 401s (not 400) when there's no session cookie --
    // confirmed empirically, not assumed from the endpoint declaration order.
    expect(res.status).toBe(401)
  })
})

describe('email (HttpApiBuilder group, Step 6)', () => {
  it('GET /api/email/logs returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/email/logs'))

    expect(res.status).toBe(401)
  })

  it('POST /api/email/send-mix-notification returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/email/send-mix-notification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mixSlug: 'test-mix' }),
      }),
    )

    expect(res.status).toBe(401)
  })
})

describe('invite (HttpApiBuilder group, Step 6)', () => {
  it('POST /api/invite/send returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/invite/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000000' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/invite/confirm is handled by this group (not the Hono fallback)', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/invite/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-real-token', password: 'irrelevant-password' }),
      }),
    )

    // No auth required (matches the old Hono route). Asserting != 404 rather
    // than a specific status: an unknown token 400s from the handler's own
    // HttpApiError.BadRequest when the DB is reachable, but this suite runs
    // without a live DB in some environments, in which case the verification
    // lookup dies and the group's own error handling turns that into a 500
    // -- either way, a 404 would mean the Hono fallback or better-auth's
    // wildcard matched instead of this endpoint, which is the actual
    // regression this test guards against.
    expect(res.status).not.toBe(404)
  })

  it('POST /api/invite/confirm 400s on a malformed request body regardless of DB state', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/invite/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notToken: 'missing required fields' }),
      }),
    )

    // Schema decode failure short-circuits before any DB call, so this
    // assertion holds even when the DB is unreachable.
    expect(res.status).toBe(400)
  })
})

describe('favorites (HttpApiBuilder group, Step 6)', () => {
  it('GET /api/favorites returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/favorites'))

    expect(res.status).toBe(401)
  })

  it('POST /api/favorites returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioId: '00000000-0000-0000-0000-000000000000' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/favorites/:audioId returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/favorites/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/favorites/show/:showId returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/favorites/show/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/favorites/:audioId returns 401 (not 400) for a non-UUID audioId without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/favorites/not-a-uuid', { method: 'DELETE' }),
    )

    // AuthMiddleware runs before param schema validation (same ordering as
    // admin's frontend-errors :scenario case) -- a malformed audioId still
    // 401s rather than 400ing, since there's no session cookie either way.
    expect(res.status).toBe(401)
  })
})

describe('music-reminders (HttpApiBuilder group, Step 6)', () => {
  it('GET /api/music-reminders returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/music-reminders'))

    expect(res.status).toBe(401)
  })

  it('POST /api/music-reminders returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music-reminders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          musicTitle: 'Test Song',
          artistName: 'Test Artist',
          musicUrl: 'https://example.com/track',
          reminderDate: '2030-01-01T00:00:00Z',
        }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('PUT /api/music-reminders/:id returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music-reminders/00000000-0000-0000-0000-000000000000', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ musicTitle: 'Updated' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/music-reminders/:id returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music-reminders/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/music-reminders/:id returns 401 (not 400) for a non-UUID id without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/music-reminders/not-a-uuid', { method: 'DELETE' }),
    )

    // AuthMiddleware runs before param schema validation (same ordering as
    // favorites' non-UUID case above) -- a malformed id still 401s rather
    // than 400ing, since there's no session cookie either way.
    expect(res.status).toBe(401)
  })
})

describe('upload (HttpApiBuilder group, Step 7)', () => {
  // The old unauthenticated /api/upload/file proxy is gone (#131 part 1) --
  // presignImage replaces it and requires a session like every other upload
  // endpoint below, since the presigned URL is scoped to the caller's own
  // userId-prefixed key.
  it('POST /api/upload/image/presign returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/upload/image/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: 'artwork.png',
          contentType: 'image/png',
          fileSize: 1024,
        }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/upload/multipart/init returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/upload/multipart/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: 'test.mp3',
          contentType: 'audio/mpeg',
          fileSize: 1024,
          fileType: 'audio',
        }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/upload/multipart/presign-part returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/upload/multipart/presign-part', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'user123/audio_1_test.mp3',
          uploadId: 'upload-id',
          partNumber: 1,
        }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it("POST /api/upload/multipart/presign-part returns 400 for a key outside the caller's own prefix", async () => {
    const suffix = crypto.randomUUID()
    const userId = `upload-owner-${suffix}`
    const token = `upload-owner-token-${suffix}`

    await db
      .insert(user)
      .values({ id: userId, name: 'Upload owner', email: `${userId}@example.com` })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    try {
      const res = await webHandler.handler(
        new Request('http://localhost/api/upload/multipart/presign-part', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            // assertKeyOwnership requires the key to start with `${userId}/`
            // -- this key belongs to a different user prefix entirely.
            key: 'someone-elses-user-id/multipart/uuid/1024/audio_test.mp3',
            uploadId: 'upload-id',
            partNumber: 1,
          }),
        }),
      )

      expect(res.status).toBe(400)
    } finally {
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('POST /api/upload/multipart/complete returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/upload/multipart/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'user123/audio_1_test.mp3',
          uploadId: 'upload-id',
          parts: [{ partNumber: 1, etag: 'etag1' }],
        }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/upload/multipart/abort returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/upload/multipart/abort', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'user123/audio_1_test.mp3', uploadId: 'upload-id' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('GET /api/upload/multipart/status returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request(
        'http://localhost/api/upload/multipart/status?key=user123%2Faudio_1_test.mp3&uploadId=upload-id',
      ),
    )

    expect(res.status).toBe(401)
  })
})

describe('newsletter (HttpApiBuilder group, Step 6)', () => {
  it('POST /api/newsletter/unsubscribe returns 404 for an unknown token', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: '00000000-0000-0000-0000-000000000000' }),
      }),
    )

    expect(res.status).toBe(404)
  })

  it('POST /api/newsletter/subscribe 400s on a malformed request body', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notEmail: 'missing required field' }),
      }),
    )

    expect(res.status).toBe(400)
  })

  it('POST /api/newsletter/request-unsubscribe returns 200 even for an unknown email (no enumeration signal)', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/newsletter/request-unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'definitely-not-a-real-subscriber@example.com' }),
      }),
    )

    // Matches the old handler: always 200 with { sent: true } regardless of
    // whether the email is on the list, so this endpoint can't be used to
    // enumerate subscribers.
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sent: true })
  })

  it('responds 404 to unsupported methods on the newsletter subscribe path', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/newsletter/subscribe', { method: 'GET' }),
    )

    expect(res.status).toBe(404)
  })

  it('POST /api/newsletter/subscribe 400s on an invalid email format', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      }),
    )

    expect(res.status).toBe(400)
  })

  it('POST /api/newsletter/unsubscribe 400s on a non-UUID token', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-uuid' }),
      }),
    )

    expect(res.status).toBe(400)
  })
})

describe('file-manager (HttpApiBuilder group, Step 6)', () => {
  it('GET /api/file-manager/config returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/file-manager/config'))

    expect(res.status).toBe(401)
  })

  it('GET /api/file-manager/list returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/file-manager/list?bucketName=test-bucket'),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/file-manager/copy returns 404 after the dead endpoint is removed', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/file-manager/copy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'some-key',
          sourceBucket: 'a',
          destinationBucket: 'b',
        }),
      }),
    )

    expect(res.status).toBe(404)
  })
})

describe('spotify (HttpApiBuilder group, Step 6)', () => {
  it('POST /api/spotify/track 400s on an empty id (no auth required, unlike other groups)', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/spotify/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: '' }),
      }),
    )

    expect(res.status).toBe(400)
  })

  it('POST /api/spotify/search/albums 400s on an empty query', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/spotify/search/albums', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '' }),
      }),
    )

    expect(res.status).toBe(400)
  })

  it('POST /api/spotify/search/albums 400s on limit above the 50 max', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/spotify/search/albums', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'test', limit: 999 }),
      }),
    )

    expect(res.status).toBe(400)
  })

  it('POST /api/spotify/enrich 400s on a non-URL string', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/spotify/enrich', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-url' }),
      }),
    )

    expect(res.status).toBe(400)
  })

  it('POST /api/spotify/track with a real-shaped id returns a real status (not 401 -- unauthenticated is fine for this group)', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/spotify/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'not-a-real-spotify-id' }),
      }),
    )

    // No AuthMiddleware on this group (matches the old Hono routes, which
    // had no betterAuthMiddleware). An invalid-but-nonempty Spotify ID
    // reaches SpotifyService, which fails with statusCode 400 -- this is
    // the specific bug fix this PR makes (the old handler's generic error
    // mapper hard-coded every SpotifyError to 502 regardless of the
    // service's own statusCode).
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(502)
  })
})

describe('shows (HttpApiBuilder group, Step 6)', () => {
  it('GET /api/shows works without a session cookie (optional auth, matches old attachSessionContext)', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/shows'))

    // Not 401 -- getAllShows never requires auth, it only uses a session
    // (if present) to decide whether to include drafts. A DB-connectivity
    // 500 in this environment is still evidence the request wasn't
    // rejected for lacking a cookie.
    expect(res.status).not.toBe(401)
  })

  it('GET /api/shows/:slug returns something other than 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/shows/does-not-exist-slug'),
    )

    expect(res.status).not.toBe(401)
  })

  it('GET /api/shows?limit=999 400s (limit above the 100 max)', async () => {
    const res = await webHandler.handler(new Request('http://localhost/api/shows?limit=999'))

    expect(res.status).toBe(400)
  })

  it('POST /api/shows returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/shows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Test Show', slug: 'test-show', content: 'hello' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('PATCH /api/shows/:slug returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/shows/some-slug', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/shows/:slug returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/shows/some-slug', { method: 'DELETE' }),
    )

    expect(res.status).toBe(401)
  })

  it('POST /api/shows/:id/subscribe returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/shows/00000000-0000-0000-0000-000000000000/subscribe', {
        method: 'POST',
      }),
    )

    expect(res.status).toBe(401)
  })

  it('DELETE /api/shows/:id/unsubscribe returns 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/shows/00000000-0000-0000-0000-000000000000/unsubscribe', {
        method: 'DELETE',
      }),
    )

    expect(res.status).toBe(401)
  })

  it('GET /api/shows/:id/subscription checks only the current listener and published show', async () => {
    const listenerId = crypto.randomUUID()
    const otherId = crypto.randomUUID()
    const token = crypto.randomUUID()
    const showId = crypto.randomUUID()
    const draftId = crypto.randomUUID()

    await db.insert(user).values([
      { id: listenerId, name: 'Listener', email: `${listenerId}@example.com` },
      { id: otherId, name: 'Other listener', email: `${otherId}@example.com` },
    ])
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId: listenerId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db.insert(showsTable).values([
      { id: showId, title: 'Published', slug: showId, content: '' },
      { id: draftId, title: 'Draft', slug: draftId, content: '', draft: true },
    ])
    await db.insert(showSubscriptionsTable).values([
      { userId: otherId, showId },
      { userId: listenerId, showId: draftId },
    ])

    const status = (id: string) =>
      webHandler.handler(
        new Request(`http://localhost/api/shows/${id}/subscription`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      )

    const anonymous = await webHandler.handler(
      new Request(`http://localhost/api/shows/${showId}/subscription`),
    )

    expect(anonymous.status).toBe(401)

    const inactive = await status(showId)
    expect(inactive.status).toBe(200)
    expect(await inactive.json()).toEqual({ subscribed: false })

    const hiddenDraft = await status(draftId)
    expect(hiddenDraft.status).toBe(200)
    expect(await hiddenDraft.json()).toEqual({ subscribed: false })

    await db.insert(showSubscriptionsTable).values({ userId: listenerId, showId })
    const active = await status(showId)
    expect(active.status).toBe(200)
    expect(await active.json()).toEqual({ subscribed: true })
  })

  it('POST /api/shows/:id/subscribe returns 401 (not 400) for a non-UUID id without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/shows/not-a-uuid/subscribe', { method: 'POST' }),
    )

    // AuthMiddleware runs before param schema validation, same ordering as
    // admin/favorites/file-manager.
    expect(res.status).toBe(401)
  })

  it('GET /api/shows/:slug/episodes returns something other than 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/shows/does-not-exist-slug/episodes'),
    )

    expect(res.status).not.toBe(401)
  })

  it('GET /api/shows/:slug/qr-pdf returns something other than 401 without a session cookie', async () => {
    const res = await webHandler.handler(
      new Request('http://localhost/api/shows/does-not-exist-slug/qr-pdf'),
    )

    expect(res.status).not.toBe(401)
  })
})

describe('micro post replies (community permission, Slice 4)', () => {
  it('lets any authenticated user reply to a tweet, without broadening top-level post-create access', async () => {
    const suffix = crypto.randomUUID()
    const plainUserId = `reply-user-${suffix}`
    const plainUserToken = `reply-user-token-${suffix}`
    const parentSlug = `parent-tweet-${suffix}`

    await db.insert(user).values({
      id: plainUserId,
      name: 'Plain user',
      email: `${plainUserId}@example.com`,
      // no role -- not creator/editor/admin
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token: plainUserToken,
      userId: plainUserId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const [parentPost] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: parentSlug,
        content: 'Original tweet',
        type: 'micro',
        draft: false,
      })
      .returning()

    if (!parentPost) throw new Error('Failed to seed parent tweet')
    await db.insert(postCreators).values({ postId: parentPost.id, creatorId: plainUserId })

    const authenticatedRequest = (url: string, token: string, init: RequestInit = {}) => {
      const request = new Request(url, init)
      request.headers.set('authorization', `Bearer ${token}`)

      return request
    }

    let replyId: string | undefined

    try {
      const unauthenticatedReply = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${parentSlug}/replies`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: 'no session' }),
        }),
      )

      expect(unauthenticatedReply.status).toBe(401)

      const replyRes = await webHandler.handler(
        authenticatedRequest(
          `http://localhost/api/content/posts/micro/${parentSlug}/replies`,
          plainUserToken,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content: 'a reply from a plain user' }),
          },
        ),
      )

      expect(replyRes.status).toBe(200)
      const replyBody = await decodeResponseBody(CompiledMicroPostResponse, replyRes)
      replyId = replyBody.id
      expect(replyBody.parentPostId).toBe(parentPost.id)
      expect(replyBody.rootPostId).toBe(parentPost.id)
      expect(replyBody.depth).toBe(1)

      const createTopLevelRes = await webHandler.handler(
        authenticatedRequest('http://localhost/api/content/post', plainUserToken, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slug: `plain-user-post-${suffix}`,
            content: 'attempted top-level tweet',
            type: 'micro',
          }),
        }),
      )

      // Community reply permission must not broaden top-level create access:
      // a plain-role user can reply (above) but cannot create a top-level post.
      expect(createTopLevelRes.status).toBe(403)
    } finally {
      await db.delete(postCreators).where(eq(postCreators.postId, parentPost.id))

      if (replyId) {
        await db.delete(postCreators).where(eq(postCreators.postId, replyId))
      }

      await db.delete(postsTable).where(eq(postsTable.rootPostId, parentPost.id))
      await db.delete(postsTable).where(eq(postsTable.id, parentPost.id))
      await db.delete(postsTable).where(eq(postsTable.slug, `plain-user-post-${suffix}`))
      await db.delete(user).where(eq(user.id, plainUserId))
    }
  })

  it('404s when the parent slug does not exist', async () => {
    const suffix = crypto.randomUUID()
    const userId = `reply-missing-parent-${suffix}`
    const token = `reply-missing-parent-token-${suffix}`

    await db.insert(user).values({ id: userId, name: 'User', email: `${userId}@example.com` })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    try {
      const res = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/does-not-exist-${suffix}/replies`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ content: 'reply to nothing' }),
        }),
      )

      expect(res.status).toBe(404)
    } finally {
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('accepts a music entity attached to a reply, matching top-level tweets (no existence check)', async () => {
    const suffix = crypto.randomUUID()
    const userId = `reply-music-entity-${suffix}`
    const token = `reply-music-entity-token-${suffix}`
    const parentSlug = `parent-tweet-music-${suffix}`
    const fakeTrackId = crypto.randomUUID()

    await db.insert(user).values({ id: userId, name: 'User', email: `${userId}@example.com` })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const [parentPost] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: parentSlug,
        content: 'Original tweet',
        type: 'micro',
        draft: false,
      })
      .returning()

    if (!parentPost) throw new Error('Failed to seed parent tweet')
    await db.insert(postCreators).values({ postId: parentPost.id, creatorId: userId })

    let replyId: string | undefined

    try {
      const res = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${parentSlug}/replies`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            content: 'check out this track',
            musicEntityType: 'track',
            musicEntityId: fakeTrackId,
          }),
        }),
      )

      expect(res.status).toBe(200)
      const body = await decodeResponseBody(CompiledMicroPostResponse, res)
      replyId = body.id
      // No existence-check on musicEntityId today for top-level posts
      // (createEffect relies on the FK constraint alone), so a reply to a
      // non-existent track id succeeds the same way, matching that behavior.
      expect(body.musicEntityType).toBe('track')
      expect(body.musicEntityId).toBe(fakeTrackId)
    } finally {
      if (replyId) {
        await db.delete(postCreators).where(eq(postCreators.postId, replyId))
      }

      await db.delete(postCreators).where(eq(postCreators.postId, parentPost.id))
      await db.delete(postsTable).where(eq(postsTable.rootPostId, parentPost.id))
      await db.delete(postsTable).where(eq(postsTable.id, parentPost.id))
      await db.delete(user).where(eq(user.id, userId))
    }
  })
})

describe('micro post replies against non-replyable/invisible parents (Slice 5)', () => {
  it('422s when the parent post is editorial, not a tweet', async () => {
    const suffix = crypto.randomUUID()
    const userId = `reply-editorial-parent-${suffix}`
    const token = `reply-editorial-parent-token-${suffix}`
    const parentSlug = `editorial-parent-${suffix}`

    await db.insert(user).values({ id: userId, name: 'User', email: `${userId}@example.com` })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const [parentPost] = await db
      .insert(postsTable)
      .values({
        title: 'An editorial post',
        slug: parentSlug,
        content: 'Editorial body',
        type: 'post',
        draft: false,
      })
      .returning()

    if (!parentPost) throw new Error('Failed to seed editorial parent')

    try {
      const res = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${parentSlug}/replies`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ content: 'reply to an editorial post' }),
        }),
      )

      expect(res.status).toBe(422)
    } finally {
      await db.delete(postsTable).where(eq(postsTable.id, parentPost.id))
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('404s when the parent tweet is a draft the actor cannot see', async () => {
    const suffix = crypto.randomUUID()
    const ownerId = `reply-draft-owner-${suffix}`
    const outsiderId = `reply-draft-outsider-${suffix}`
    const outsiderToken = `reply-draft-outsider-token-${suffix}`
    const parentSlug = `draft-parent-${suffix}`

    await db.insert(user).values([
      { id: ownerId, name: 'Owner', email: `${ownerId}@example.com` },
      { id: outsiderId, name: 'Outsider', email: `${outsiderId}@example.com` },
    ])
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token: outsiderToken,
      userId: outsiderId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const [parentPost] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: parentSlug,
        content: 'Draft tweet',
        type: 'micro',
        draft: true,
      })
      .returning()

    if (!parentPost) throw new Error('Failed to seed draft parent')
    await db.insert(postCreators).values({ postId: parentPost.id, creatorId: ownerId })

    try {
      const res = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${parentSlug}/replies`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${outsiderToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ content: 'reply to a hidden draft' }),
        }),
      )

      expect(res.status).toBe(404)
    } finally {
      await db.delete(postCreators).where(eq(postCreators.postId, parentPost.id))
      await db.delete(postsTable).where(eq(postsTable.id, parentPost.id))
      await db.delete(user).where(eq(user.id, ownerId))
      await db.delete(user).where(eq(user.id, outsiderId))
    }
  })
})

describe('GET /api/content/posts/micro/:parentSlug/replies (Slice 6)', () => {
  it('returns only direct replies to the given parent, oldest-first, excluding unrelated replies and the parent itself', async () => {
    const suffix = crypto.randomUUID()
    const authorId = `replies-author-${suffix}`
    const parentSlug = `replies-parent-${suffix}`
    const otherParentSlug = `replies-other-parent-${suffix}`

    await db.insert(user).values({ id: authorId, name: 'Author', email: `${authorId}@example.com` })

    const [parentPost] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: parentSlug,
        content: 'Original tweet',
        type: 'micro',
        draft: false,
      })
      .returning()

    if (!parentPost) throw new Error('Failed to seed parent tweet')

    const [otherParentPost] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: otherParentSlug,
        content: 'A different tweet',
        type: 'micro',
        draft: false,
      })
      .returning()

    if (!otherParentPost) throw new Error('Failed to seed other parent tweet')

    const [firstReply] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: `replies-first-${suffix}`,
        content: 'first reply',
        type: 'micro',
        draft: false,
        parentPostId: parentPost.id,
        rootPostId: parentPost.id,
        depth: 1,
        createdAt: new Date(Date.now() - 60_000),
      })
      .returning()

    if (!firstReply) throw new Error('Failed to seed first reply')

    const [secondReply] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: `replies-second-${suffix}`,
        content: 'second reply',
        type: 'micro',
        draft: false,
        parentPostId: parentPost.id,
        rootPostId: parentPost.id,
        depth: 1,
        createdAt: new Date(),
      })
      .returning()

    if (!secondReply) throw new Error('Failed to seed second reply')

    const [unrelatedReply] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: `replies-unrelated-${suffix}`,
        content: 'reply to a different parent',
        type: 'micro',
        draft: false,
        parentPostId: otherParentPost.id,
        rootPostId: otherParentPost.id,
        depth: 1,
      })
      .returning()

    if (!unrelatedReply) throw new Error('Failed to seed unrelated reply')

    await db.insert(postCreators).values([
      { postId: parentPost.id, creatorId: authorId },
      { postId: otherParentPost.id, creatorId: authorId },
      { postId: firstReply.id, creatorId: authorId },
      { postId: secondReply.id, creatorId: authorId },
      { postId: unrelatedReply.id, creatorId: authorId },
    ])

    try {
      const res = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${parentSlug}/replies`),
      )

      expect(res.status).toBe(200)

      const body = await decodeResponseBody(GetMicroPostsResponse, res)
      expect(body.data.map((p) => p.slug)).toEqual([firstReply.slug, secondReply.slug])
      expect(body.pagination.total).toBe(2)
    } finally {
      await db.delete(postCreators).where(eq(postCreators.postId, parentPost.id))
      await db.delete(postCreators).where(eq(postCreators.postId, otherParentPost.id))
      await db.delete(postCreators).where(eq(postCreators.postId, firstReply.id))
      await db.delete(postCreators).where(eq(postCreators.postId, secondReply.id))
      await db.delete(postCreators).where(eq(postCreators.postId, unrelatedReply.id))
      await db.delete(postsTable).where(eq(postsTable.id, firstReply.id))
      await db.delete(postsTable).where(eq(postsTable.id, secondReply.id))
      await db.delete(postsTable).where(eq(postsTable.id, unrelatedReply.id))
      await db.delete(postsTable).where(eq(postsTable.id, parentPost.id))
      await db.delete(postsTable).where(eq(postsTable.id, otherParentPost.id))
      await db.delete(user).where(eq(user.id, authorId))
    }
  })

  it('404s when the parent slug does not exist', async () => {
    const suffix = crypto.randomUUID()

    const res = await webHandler.handler(
      new Request(`http://localhost/api/content/posts/micro/does-not-exist-${suffix}/replies`),
    )

    expect(res.status).toBe(404)
  })
})

describe('GET /api/content/posts/micro/:slug/thread (Slice 7)', () => {
  it('returns the full thread regardless of which node in it is requested', async () => {
    const suffix = crypto.randomUUID()
    const authorId = `thread-author-${suffix}`
    const rootSlug = `thread-root-${suffix}`
    const replySlug = `thread-reply-${suffix}`
    const nestedReplySlug = `thread-nested-reply-${suffix}`

    await db.insert(user).values({ id: authorId, name: 'Author', email: `${authorId}@example.com` })

    const [rootPost] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: rootSlug,
        content: 'Root tweet',
        type: 'micro',
        draft: false,
        createdAt: new Date(Date.now() - 120_000),
      })
      .returning()

    if (!rootPost) throw new Error('Failed to seed root tweet')

    const [reply] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: replySlug,
        content: 'direct reply',
        type: 'micro',
        draft: false,
        parentPostId: rootPost.id,
        rootPostId: rootPost.id,
        depth: 1,
        createdAt: new Date(Date.now() - 60_000),
      })
      .returning()

    if (!reply) throw new Error('Failed to seed direct reply')

    const [nestedReply] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: nestedReplySlug,
        content: 'nested reply',
        type: 'micro',
        draft: false,
        parentPostId: reply.id,
        rootPostId: rootPost.id,
        depth: 2,
        createdAt: new Date(),
      })
      .returning()

    if (!nestedReply) throw new Error('Failed to seed nested reply')

    await db.insert(postCreators).values([
      { postId: rootPost.id, creatorId: authorId },
      { postId: reply.id, creatorId: authorId },
      { postId: nestedReply.id, creatorId: authorId },
    ])

    try {
      const rootRes = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${rootSlug}/thread`),
      )

      expect(rootRes.status).toBe(200)
      const rootBody = await decodeResponseBody(MicroPostThreadResponse, rootRes)
      expect(rootBody.root.slug).toBe(rootSlug)
      expect(rootBody.focus.slug).toBe(rootSlug)
      expect(rootBody.posts.map((p) => p.slug)).toEqual([replySlug, nestedReplySlug])
      expect(rootBody.pagination.total).toBe(2)

      const nestedRes = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${nestedReplySlug}/thread`),
      )

      expect(nestedRes.status).toBe(200)
      const nestedBody = await decodeResponseBody(MicroPostThreadResponse, nestedRes)
      expect(nestedBody.root.slug).toBe(rootSlug)
      expect(nestedBody.focus.slug).toBe(nestedReplySlug)
      expect(nestedBody.posts.map((p) => p.slug)).toEqual([replySlug, nestedReplySlug])
      expect(nestedBody.pagination.total).toBe(2)
    } finally {
      await db.delete(postCreators).where(eq(postCreators.postId, rootPost.id))
      await db.delete(postCreators).where(eq(postCreators.postId, reply.id))
      await db.delete(postCreators).where(eq(postCreators.postId, nestedReply.id))
      await db.delete(postsTable).where(eq(postsTable.id, nestedReply.id))
      await db.delete(postsTable).where(eq(postsTable.id, reply.id))
      await db.delete(postsTable).where(eq(postsTable.id, rootPost.id))
      await db.delete(user).where(eq(user.id, authorId))
    }
  })

  it('404s when the slug does not exist', async () => {
    const suffix = crypto.randomUUID()

    const res = await webHandler.handler(
      new Request(`http://localhost/api/content/posts/micro/does-not-exist-${suffix}/thread`),
    )

    expect(res.status).toBe(404)
  })
})

describe('GET /api/content/posts/micro/:slug/screen', () => {
  it('returns verified music attachments for the tweet, replies, root, and quote in one response', async () => {
    const suffix = crypto.randomUUID()
    const authorId = `screen-author-${suffix}`
    const rootSlug = `screen-root-${suffix}`
    const replySlug = `screen-reply-${suffix}`
    const quoteSlug = `screen-quote-${suffix}`
    const image = 'https://cdn.goosebumps.fm/user-content/screen-author.png'
    const rootAlbumId = crypto.randomUUID()
    const replyTrackId = crypto.randomUUID()
    const quotePlaylistId = crypto.randomUUID()

    await db.insert(user).values({
      id: authorId,
      name: 'Screen Author',
      email: `${authorId}@example.com`,
      username: `screen-${suffix}`,
      image,
    })
    await db.batch([
      db
        .insert(musicEntityTypesTable)
        .values([
          { id: 'album', displayName: 'Album' },
          { id: 'track', displayName: 'Track' },
          { id: 'playlist', displayName: 'Playlist' },
        ])
        .onConflictDoNothing(),
      db
        .insert(musicPlatformsTable)
        .values([
          { id: 'spotify', displayName: 'Spotify' },
          { id: 'bandcamp', displayName: 'Bandcamp' },
        ])
        .onConflictDoNothing(),
      db.insert(musicAlbumsTable).values({
        id: rootAlbumId,
        title: 'Root Album',
        slug: `root-album-${suffix}`,
        artistNames: ['Root Artist'],
        coverImageUrl: 'https://cdn.goosebumps.fm/user-content/root-album.png',
      }),
      db.insert(musicTracksTable).values({
        id: replyTrackId,
        title: 'Reply Track',
        slug: `reply-track-${suffix}`,
        artistNames: ['Reply Artist'],
        coverImageUrl: 'https://cdn.goosebumps.fm/user-content/reply-track.png',
      }),
      db.insert(musicPlaylistsTable).values({
        id: quotePlaylistId,
        title: 'Quote Playlist',
        slug: `quote-playlist-${suffix}`,
        coverImageUrl: 'https://cdn.goosebumps.fm/user-content/quote-playlist.png',
      }),
    ])
    await db.insert(musicEntityLinksTable).values([
      {
        entityType: 'album',
        entityId: rootAlbumId,
        platform: 'spotify',
        url: 'https://open.spotify.com/album/root',
        status: 'verified',
      },
      {
        entityType: 'track',
        entityId: replyTrackId,
        platform: 'bandcamp',
        url: 'https://artist.bandcamp.com/track/reply',
        status: 'verified',
      },
      {
        entityType: 'track',
        entityId: replyTrackId,
        platform: 'spotify',
        url: 'https://open.spotify.com/track/rejected',
        status: 'rejected',
      },
      {
        entityType: 'playlist',
        entityId: quotePlaylistId,
        platform: 'spotify',
        url: 'https://open.spotify.com/playlist/quote',
        status: 'verified',
      },
    ])

    const [quote, root] = await db
      .insert(postsTable)
      .values([
        {
          slug: quoteSlug,
          content: 'Quoted tweet',
          type: 'micro',
          draft: false,
          musicEntityType: 'playlist',
          musicEntityId: quotePlaylistId,
        },
        {
          slug: rootSlug,
          content: 'Root tweet',
          type: 'micro',
          draft: false,
          musicEntityType: 'album',
          musicEntityId: rootAlbumId,
        },
      ])
      .returning()

    if (!quote || !root) throw new Error('Failed to seed tweet screen')
    await db.update(postsTable).set({ quotedPostId: quote.id }).where(eq(postsTable.id, root.id))

    const [reply] = await db
      .insert(postsTable)
      .values({
        slug: replySlug,
        content: 'Reply tweet',
        type: 'micro',
        draft: false,
        parentPostId: root.id,
        rootPostId: root.id,
        depth: 1,
        musicEntityType: 'track',
        musicEntityId: replyTrackId,
      })
      .returning()

    if (!reply) throw new Error('Failed to seed tweet reply')
    await db.insert(postCreators).values([
      { postId: root.id, creatorId: authorId },
      { postId: reply.id, creatorId: authorId },
      { postId: quote.id, creatorId: authorId },
    ])

    try {
      const response = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${rootSlug}/screen`),
      )

      expect(response.status).toBe(200)
      const body = await decodeResponseBody(MicroPostScreenResponse, response)
      expect(body.post.slug).toBe(rootSlug)
      expect(body.post.creators?.[0]?.image).toBe(image)
      expect(body.replies.map((post) => post.slug)).toEqual([replySlug])
      expect(body.root.slug).toBe(rootSlug)
      expect(body.quote?.slug).toBe(quoteSlug)
      expect(body.post.music).toEqual({
        entity: {
          id: rootAlbumId,
          type: 'album',
          title: 'Root Album',
          artistNames: ['Root Artist'],
          coverImageUrl: 'https://cdn.goosebumps.fm/user-content/root-album.png',
        },
        links: [{ platform: 'spotify', url: 'https://open.spotify.com/album/root' }],
      })
      expect(body.root.music).toEqual(body.post.music)
      expect(body.quote?.music?.entity).toMatchObject({
        id: quotePlaylistId,
        type: 'playlist',
        title: 'Quote Playlist',
        artistNames: null,
      })
      expect(body.replies[0]?.music).toEqual({
        entity: {
          id: replyTrackId,
          type: 'track',
          title: 'Reply Track',
          artistNames: ['Reply Artist'],
          coverImageUrl: 'https://cdn.goosebumps.fm/user-content/reply-track.png',
        },
        links: [{ platform: 'bandcamp', url: 'https://artist.bandcamp.com/track/reply' }],
      })

      const mainResponse = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${rootSlug}/screen?part=main`),
      )

      expect(mainResponse.status).toBe(200)
      const main = await decodeResponseBody(MicroPostScreenResponse, mainResponse)
      expect(main.post).toEqual(body.post)
      expect(main.root).toEqual(body.root)
      expect(main.quote).toEqual(body.quote)
      expect(main.replies).toEqual([])

      const repliesResponse = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${rootSlug}/screen/replies`),
      )

      expect(repliesResponse.status).toBe(200)
      const replies = await decodeResponseBody(MicroPostScreenRepliesResponse, repliesResponse)
      expect(replies).toEqual(body.replies)
    } finally {
      await db.delete(postCreators).where(eq(postCreators.creatorId, authorId))
      await db.delete(postsTable).where(eq(postsTable.id, reply.id))
      await db.delete(postsTable).where(eq(postsTable.id, root.id))
      await db.delete(postsTable).where(eq(postsTable.id, quote.id))
      await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, rootAlbumId))
      await db.delete(musicEntityLinksTable).where(eq(musicEntityLinksTable.entityId, replyTrackId))
      await db
        .delete(musicEntityLinksTable)
        .where(eq(musicEntityLinksTable.entityId, quotePlaylistId))
      await db.delete(musicAlbumsTable).where(eq(musicAlbumsTable.id, rootAlbumId))
      await db.delete(musicTracksTable).where(eq(musicTracksTable.id, replyTrackId))
      await db.delete(musicPlaylistsTable).where(eq(musicPlaylistsTable.id, quotePlaylistId))
      await db.delete(user).where(eq(user.id, authorId))
    }
  })

  it('404s when the tweet does not exist', async () => {
    const response = await webHandler.handler(
      new Request(`http://localhost/api/content/posts/micro/missing-${crypto.randomUUID()}/screen`),
    )

    expect(response.status).toBe(404)
  })
})

describe('GET /api/content/posts/micro music attachments', () => {
  it('adds verified music to each tweet in the page without changing paging or filtering', async () => {
    const suffix = crypto.randomUUID()
    const tag = `feed-music-${suffix}`
    const albumId = crypto.randomUUID()
    const trackId = crypto.randomUUID()
    const minute = 60_000
    const now = Date.now()

    await db.batch([
      db
        .insert(musicEntityTypesTable)
        .values([
          { id: 'album', displayName: 'Album' },
          { id: 'track', displayName: 'Track' },
        ])
        .onConflictDoNothing(),
      db
        .insert(musicPlatformsTable)
        .values([{ id: 'spotify', displayName: 'Spotify' }])
        .onConflictDoNothing(),
      db.insert(musicAlbumsTable).values({
        id: albumId,
        title: 'Feed Album',
        slug: `feed-album-${suffix}`,
        artistNames: ['Feed Artist'],
        coverImageUrl: 'https://cdn.goosebumps.fm/user-content/feed-album.png',
      }),
      db.insert(musicTracksTable).values({
        id: trackId,
        title: 'Feed Track',
        slug: `feed-track-${suffix}`,
        artistNames: null,
        coverImageUrl: null,
      }),
    ])
    await db.insert(musicEntityLinksTable).values([
      {
        entityType: 'album',
        entityId: albumId,
        platform: 'spotify',
        url: 'https://open.spotify.com/album/feed',
        status: 'verified',
      },
      {
        entityType: 'track',
        entityId: trackId,
        platform: 'spotify',
        url: 'https://open.spotify.com/track/rejected',
        status: 'rejected',
      },
    ])

    const seeded = await db
      .insert(postsTable)
      .values([
        {
          slug: `feed-album-tweet-${suffix}`,
          content: 'album tweet',
          type: 'micro',
          draft: false,
          musicEntityType: 'album',
          musicEntityId: albumId,
          createdAt: new Date(now),
        },
        {
          slug: `feed-plain-tweet-${suffix}`,
          content: 'plain tweet',
          type: 'micro',
          draft: false,
          createdAt: new Date(now - minute),
        },
        {
          slug: `feed-track-tweet-${suffix}`,
          content: 'track tweet',
          type: 'micro',
          draft: false,
          musicEntityType: 'track',
          musicEntityId: trackId,
          createdAt: new Date(now - 2 * minute),
        },
        {
          slug: `feed-draft-tweet-${suffix}`,
          content: 'draft tweet',
          type: 'micro',
          draft: true,
          musicEntityType: 'album',
          musicEntityId: albumId,
          createdAt: new Date(now - 3 * minute),
        },
        {
          slug: `feed-untagged-tweet-${suffix}`,
          content: 'untagged tweet',
          type: 'micro',
          draft: false,
          musicEntityType: 'album',
          musicEntityId: albumId,
          createdAt: new Date(now - 4 * minute),
        },
      ])
      .returning()

    const [albumTweet, plainTweet, trackTweet, draftTweet] = seeded

    if (!albumTweet || !plainTweet || !trackTweet || !draftTweet)
      throw new Error('Failed to seed tweet feed')

    const [reply] = await db
      .insert(postsTable)
      .values({
        slug: `feed-reply-${suffix}`,
        content: 'reply tweet',
        type: 'micro',
        draft: false,
        parentPostId: albumTweet.id,
        rootPostId: albumTweet.id,
        depth: 1,
        musicEntityType: 'album',
        musicEntityId: albumId,
        createdAt: new Date(now + minute),
      })
      .returning()

    if (!reply) throw new Error('Failed to seed tweet feed reply')
    const taggedIds = [albumTweet.id, plainTweet.id, trackTweet.id, draftTweet.id, reply.id]
    await Promise.all(
      taggedIds.map((postId) => replaceEntityLabels(db, 'post', postId, { tags: [tag] })),
    )

    const albumMusic = {
      entity: {
        id: albumId,
        type: 'album',
        title: 'Feed Album',
        artistNames: ['Feed Artist'],
        coverImageUrl: 'https://cdn.goosebumps.fm/user-content/feed-album.png',
      },
      links: [{ platform: 'spotify', url: 'https://open.spotify.com/album/feed' }],
    }

    try {
      const firstResponse = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro?tag=${tag}&limit=2&offset=0`),
      )

      expect(firstResponse.status).toBe(200)
      const legacy = await decodeResponseBody(GetMicroPostsResponse, firstResponse.clone())
      const first = await decodeResponseBody(GetMicroPostListResponse, firstResponse)
      expect(legacy.data.map((post) => post.slug)).toEqual([albumTweet.slug, plainTweet.slug])
      expect(first.data.map((post) => post.slug)).toEqual([albumTweet.slug, plainTweet.slug])
      expect(first.pagination).toEqual({ total: 3, limit: 2, offset: 0, hasMore: true })
      expect(first.data[0]?.music).toEqual(albumMusic)
      expect(first.data[0]?.replyCount).toBe(1)
      expect(first.data[1]?.music).toBeNull()

      const secondResponse = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro?tag=${tag}&limit=2&offset=2`),
      )

      expect(secondResponse.status).toBe(200)
      const second = await decodeResponseBody(GetMicroPostListResponse, secondResponse)
      expect(second.data.map((post) => post.slug)).toEqual([trackTweet.slug])
      expect(second.pagination).toEqual({ total: 3, limit: 2, offset: 2, hasMore: false })
      expect(second.data[0]?.music).toEqual({
        entity: {
          id: trackId,
          type: 'track',
          title: 'Feed Track',
          artistNames: null,
          coverImageUrl: null,
        },
        links: [],
      })

      const albumsResponse = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro?tag=${tag}&musicEntityType=album`),
      )

      expect(albumsResponse.status).toBe(200)
      const albums = await decodeResponseBody(GetMicroPostListResponse, albumsResponse)
      expect(albums.data.map((post) => post.slug)).toEqual([albumTweet.slug])
      expect(albums.data[0]?.music).toEqual(albumMusic)
    } finally {
      await db
        .delete(entityLabelsTable)
        .where(
          and(
            eq(entityLabelsTable.entityType, 'post'),
            inArray(entityLabelsTable.entityId, taggedIds),
          ),
        )
      await db.delete(postsTable).where(eq(postsTable.id, reply.id))
      await db.delete(postsTable).where(
        inArray(
          postsTable.id,
          seeded.map((post) => post.id),
        ),
      )
      await db
        .delete(musicEntityLinksTable)
        .where(inArray(musicEntityLinksTable.entityId, [albumId, trackId]))
      await db.delete(musicAlbumsTable).where(eq(musicAlbumsTable.id, albumId))
      await db.delete(musicTracksTable).where(eq(musicTracksTable.id, trackId))
    }
  })
})

describe('PATCH /api/content/posts/:slug thread-field immutability (Slice 8)', () => {
  it('ignores parentPostId/rootPostId/depth in the request body while still applying legitimate field changes', async () => {
    const suffix = crypto.randomUUID()
    const authorId = `patch-immutable-author-${suffix}`
    const authorToken = `patch-immutable-author-token-${suffix}`
    const rootSlug = `patch-immutable-root-${suffix}`
    const replySlug = `patch-immutable-reply-${suffix}`

    await db.insert(user).values({ id: authorId, name: 'Author', email: `${authorId}@example.com` })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token: authorToken,
      userId: authorId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const [rootPost] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: rootSlug,
        content: 'Root tweet',
        type: 'micro',
        draft: false,
      })
      .returning()

    if (!rootPost) throw new Error('Failed to seed root tweet')

    const [reply] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: replySlug,
        content: 'original reply content',
        type: 'micro',
        draft: false,
        parentPostId: rootPost.id,
        rootPostId: rootPost.id,
        depth: 1,
      })
      .returning()

    if (!reply) throw new Error('Failed to seed reply')

    await db.insert(postCreators).values([
      { postId: rootPost.id, creatorId: authorId },
      { postId: reply.id, creatorId: authorId },
    ])

    try {
      const res = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/${replySlug}`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${authorToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            content: 'edited content',
            parentPostId: null,
            rootPostId: null,
            depth: 0,
          }),
        }),
      )

      expect(res.status).toBe(200)
      const body = await decodeResponseBody(CompiledPostResponse, res)
      expect(body.content).toBe('edited content')
      expect(body.parentPostId).toBe(rootPost.id)
      expect(body.rootPostId).toBe(rootPost.id)
      expect(body.depth).toBe(1)
    } finally {
      await db.delete(postCreators).where(eq(postCreators.postId, rootPost.id))
      await db.delete(postCreators).where(eq(postCreators.postId, reply.id))
      await db.delete(postsTable).where(eq(postsTable.id, reply.id))
      await db.delete(postsTable).where(eq(postsTable.id, rootPost.id))
      await db.delete(user).where(eq(user.id, authorId))
    }
  })
})

describe('content draft management authorization', () => {
  it('keeps draft posts publicly hidden while allowing only their creator and admins to manage them', async () => {
    const suffix = crypto.randomUUID()
    const ownerId = `post-owner-${suffix}`
    const unrelatedId = `post-unrelated-${suffix}`
    const adminId = `post-admin-${suffix}`
    const ownerToken = `post-owner-token-${suffix}`
    const unrelatedToken = `post-unrelated-token-${suffix}`
    const adminToken = `post-admin-token-${suffix}`
    const slug = `managed-draft-${suffix}`

    await db.insert(user).values([
      { id: ownerId, name: 'Post owner', email: `${ownerId}@example.com` },
      { id: unrelatedId, name: 'Unrelated user', email: `${unrelatedId}@example.com` },
      { id: adminId, name: 'Admin user', email: `${adminId}@example.com`, role: 'admin' },
    ])
    await db.insert(session).values([
      {
        id: crypto.randomUUID(),
        token: ownerToken,
        userId: ownerId,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: crypto.randomUUID(),
        token: unrelatedToken,
        userId: unrelatedId,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: crypto.randomUUID(),
        token: adminToken,
        userId: adminId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    ])

    const [post] = await db
      .insert(postsTable)
      .values({ title: 'Managed draft', slug, content: 'draft', type: 'post', draft: true })
      .returning()

    if (!post) throw new Error('Failed to seed managed draft post')
    await db.insert(postCreators).values({ postId: post.id, creatorId: ownerId })

    const authenticatedRequest = (url: string, token: string) =>
      new Request(url, { headers: { authorization: `Bearer ${token}` } })

    try {
      const [publicDetail, publicList, ownerDetail, adminDetail, unrelatedDetail, ownerList] =
        await Promise.all([
          webHandler.handler(new Request(`http://localhost/api/content/posts/${slug}`)),
          webHandler.handler(new Request('http://localhost/api/content/posts?limit=100')),
          webHandler.handler(
            authenticatedRequest(`http://localhost/api/content/posts/${slug}/edit`, ownerToken),
          ),
          webHandler.handler(
            authenticatedRequest(`http://localhost/api/content/posts/${slug}/edit`, adminToken),
          ),
          webHandler.handler(
            authenticatedRequest(`http://localhost/api/content/posts/${slug}/edit`, unrelatedToken),
          ),
          webHandler.handler(
            authenticatedRequest(
              'http://localhost/api/content/posts/manage?type=post&limit=100',
              ownerToken,
            ),
          ),
        ])

      expect(publicDetail.status).toBe(404)
      expect(JSON.stringify(await publicList.json())).not.toContain(slug)
      expect(ownerDetail.status).toBe(200)
      expect(adminDetail.status).toBe(200)
      expect(unrelatedDetail.status).toBe(401)
      expect(JSON.stringify(await ownerList.json())).toContain(slug)
    } finally {
      await db.delete(postCreators).where(eq(postCreators.postId, post.id))
      await db.delete(postsTable).where(eq(postsTable.id, post.id))
      await db.delete(user).where(eq(user.id, ownerId))
      await db.delete(user).where(eq(user.id, unrelatedId))
      await db.delete(user).where(eq(user.id, adminId))
    }
  })

  it('allows release mutations only to the owning label creator or an admin', async () => {
    const suffix = crypto.randomUUID()
    const ownerId = `release-owner-${suffix}`
    const unrelatedId = `release-unrelated-${suffix}`
    const adminId = `release-admin-${suffix}`
    const ownerToken = `release-owner-token-${suffix}`
    const unrelatedToken = `release-unrelated-token-${suffix}`
    const adminToken = `release-admin-token-${suffix}`
    const labelSlug = `release-label-${suffix}`

    await db.insert(user).values([
      { id: ownerId, name: 'Release owner', email: `${ownerId}@example.com` },
      { id: unrelatedId, name: 'Unrelated user', email: `${unrelatedId}@example.com` },
      { id: adminId, name: 'Admin user', email: `${adminId}@example.com`, role: 'admin' },
    ])
    await db.insert(session).values([
      {
        id: crypto.randomUUID(),
        token: ownerToken,
        userId: ownerId,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: crypto.randomUUID(),
        token: unrelatedToken,
        userId: unrelatedId,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: crypto.randomUUID(),
        token: adminToken,
        userId: adminId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    ])

    const [label] = await db
      .insert(musicLabelsTable)
      .values({ name: 'Release label', slug: labelSlug, content: '' })
      .returning()

    if (!label) throw new Error('Failed to seed release label')
    await db.insert(musicLabelCreatorsTable).values({ labelId: label.id, creatorId: ownerId })

    const createRequest = (token: string, slug: string) =>
      new Request('http://localhost/api/content/releases', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: slug,
          slug,
          content: '',
          draft: true,
          labelId: label.id,
          releaseDate: new Date().toISOString(),
        }),
      })

    try {
      const ownerSlug = `owner-release-${suffix}`
      const adminSlug = `admin-release-${suffix}`
      const deniedSlug = `denied-release-${suffix}`

      const [ownerCreate, adminCreate, unrelatedCreate] = await Promise.all([
        webHandler.handler(createRequest(ownerToken, ownerSlug)),
        webHandler.handler(createRequest(adminToken, adminSlug)),
        webHandler.handler(createRequest(unrelatedToken, deniedSlug)),
      ])

      expect(ownerCreate.status).toBe(200)
      expect(adminCreate.status).toBe(200)
      expect(unrelatedCreate.status).toBe(401)

      const updateRequest = (token: string, slug: string, title: string) =>
        new Request(`http://localhost/api/content/releases/${slug}`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ title }),
        })

      const [ownerUpdate, adminUpdate, unrelatedUpdate] = await Promise.all([
        webHandler.handler(updateRequest(ownerToken, ownerSlug, 'Owner updated')),
        webHandler.handler(updateRequest(adminToken, adminSlug, 'Admin updated')),
        webHandler.handler(updateRequest(unrelatedToken, ownerSlug, 'Denied update')),
      ])

      expect(ownerUpdate.status).toBe(200)
      expect(adminUpdate.status).toBe(200)
      expect(unrelatedUpdate.status).toBe(401)

      const deniedDelete = await webHandler.handler(
        new Request(`http://localhost/api/content/releases/${ownerSlug}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${unrelatedToken}` },
        }),
      )

      const adminDelete = await webHandler.handler(
        new Request(`http://localhost/api/content/releases/${adminSlug}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${adminToken}` },
        }),
      )

      expect(deniedDelete.status).toBe(401)
      expect(adminDelete.status).toBe(200)
    } finally {
      await db.delete(releasesTable).where(eq(releasesTable.labelId, label.id))
      await db.delete(musicLabelCreatorsTable).where(eq(musicLabelCreatorsTable.labelId, label.id))
      await db.delete(musicLabelsTable).where(eq(musicLabelsTable.id, label.id))
      await db.delete(user).where(eq(user.id, ownerId))
      await db.delete(user).where(eq(user.id, unrelatedId))
      await db.delete(user).where(eq(user.id, adminId))
    }
  })
})

describe('site routes (plain HttpRouter, Step 7)', () => {
  it('keeps drafts out of canonical API, share, tag, episode, and RSS surfaces', async () => {
    const suffix = crypto.randomUUID()
    const slug = `draft-${suffix}`
    const tag = `draft-tag-${suffix}`
    const audioId = crypto.randomUUID()
    const postId = crypto.randomUUID()

    const [publishedShow] = await db
      .insert(showsTable)
      .values({ title: 'Published parent', slug: `published-${suffix}`, content: '', draft: false })
      .returning()

    const [publishedLabel] = await db
      .insert(musicLabelsTable)
      .values({
        name: 'Published parent',
        slug: `published-${suffix}`,
        content: '',
        publishedAt: new Date(),
      })
      .returning()

    if (!publishedShow || !publishedLabel) throw new Error('Failed to seed draft visibility test')

    await Promise.all([
      db.insert(audioTable).values({
        id: audioId,
        title: 'Draft audio',
        slug,
        content: '',
        type: 'mix',
        url: 'https://example.com/draft.mp3',
        draft: true,
      }),
      db.insert(audioTable).values({
        title: 'Draft episode',
        slug: `episode-${suffix}`,
        content: '',
        type: 'mix',
        url: 'https://example.com/episode.mp3',
        showId: publishedShow.id,
        draft: true,
      }),
      db.insert(showsTable).values({ title: 'Draft show', slug, content: '', draft: true }),
      db.insert(postsTable).values({
        id: postId,
        title: 'Draft post',
        slug,
        content: 'draft',
        type: 'post',
        draft: true,
      }),
      db.insert(musicLabelsTable).values({ name: 'Draft label', slug, content: '' }),
      db.insert(releasesTable).values({
        title: 'Draft release',
        slug,
        content: '',
        labelId: publishedLabel.id,
        draft: true,
      }),
    ])
    await Promise.all([
      replaceEntityLabels(db, 'audio', audioId, { tags: [tag] }),
      replaceEntityLabels(db, 'post', postId, { tags: [tag] }),
    ])

    try {
      const responses = await Promise.all([
        webHandler.handler(new Request(`http://localhost/api/content/audio/mix/${slug}`)),
        webHandler.handler(new Request(`http://localhost/api/shows/${slug}`)),
        webHandler.handler(new Request(`http://localhost/api/content/posts/${slug}`)),
        webHandler.handler(new Request(`http://localhost/api/music/labels/slug/${slug}`)),
        webHandler.handler(new Request(`http://localhost/api/content/releases/${slug}`)),
        webHandler.handler(new Request(`http://localhost/api/content/audio/mix/${slug}/edit`)),
        webHandler.handler(new Request(`http://localhost/api/site-metadata/mix/${slug}`)),
        webHandler.handler(new Request(`http://localhost/s/mix/${slug}`)),
        webHandler.handler(new Request(`http://localhost/s/post/${slug}`)),
      ])

      expect(responses.map((response) => response.status)).toEqual([
        404, 404, 404, 404, 404, 401, 404, 404, 404,
      ])

      const [audioList, audioTags, posts, postTags, episodes, labels, rss] = await Promise.all([
        webHandler.handler(new Request('http://localhost/api/content/audio/mix?limit=100')),
        webHandler.handler(new Request('http://localhost/api/content/audio/mix/tags')),
        webHandler.handler(new Request('http://localhost/api/content/posts?limit=100')),
        webHandler.handler(new Request('http://localhost/api/content/posts/editorials/tags')),
        webHandler.handler(
          new Request(`http://localhost/api/shows/${publishedShow.slug}/episodes?limit=100`),
        ),
        webHandler.handler(new Request('http://localhost/api/music/labels')),
        webHandler.handler(new Request('http://localhost/rss.xml')),
      ])

      expect(JSON.stringify(await audioList.json())).not.toContain(slug)
      expect(await audioTags.json()).not.toContain(tag)
      expect(JSON.stringify(await posts.json())).not.toContain(slug)
      expect(await postTags.json()).not.toContain(tag)
      expect(JSON.stringify(await episodes.json())).not.toContain(`episode-${suffix}`)
      expect(JSON.stringify(await labels.json())).not.toContain(slug)
      expect(await rss.text()).not.toContain(slug)
    } finally {
      await db
        .delete(entityLabelsTable)
        .where(
          and(eq(entityLabelsTable.entityType, 'audio'), eq(entityLabelsTable.entityId, audioId)),
        )
      await db
        .delete(entityLabelsTable)
        .where(
          and(eq(entityLabelsTable.entityType, 'post'), eq(entityLabelsTable.entityId, postId)),
        )
      await db.delete(releasesTable).where(eq(releasesTable.slug, slug))
      await db.delete(audioTable).where(eq(audioTable.slug, `episode-${suffix}`))
      await db.delete(audioTable).where(eq(audioTable.slug, slug))
      await db.delete(postsTable).where(eq(postsTable.slug, slug))
      await db.delete(showsTable).where(eq(showsTable.slug, slug))
      await db.delete(showsTable).where(eq(showsTable.slug, publishedShow.slug))
      await db.delete(musicLabelsTable).where(eq(musicLabelsTable.slug, slug))
      await db.delete(musicLabelsTable).where(eq(musicLabelsTable.slug, publishedLabel.slug))
    }
  })

  it('GET /rss.xml returns a valid RSS 2.0 feed containing published mixes', async () => {
    const slug = `rss-published-${crypto.randomUUID()}`
    const olderSlug = `rss-older-${crypto.randomUUID()}`

    await db.insert(audioTable).values([
      {
        title: 'Published & valid mix',
        slug,
        content: '',
        description: 'A published mix with <escaped> text',
        type: 'mix',
        url: 'https://example.com/published.mp3?source=rss&format=mp3',
        draft: false,
        createdAt: new Date('2999-01-02T00:00:00Z'),
      },
      {
        title: 'Older published mix',
        slug: olderSlug,
        content: '',
        type: 'mix',
        url: 'https://example.com/older.mp3',
        draft: false,
        createdAt: new Date('2999-01-01T00:00:00Z'),
      },
    ])

    try {
      const res = await webHandler.handler(new Request('http://localhost/rss.xml'))

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8')

      const body = await res.text()

      expect(XMLValidator.validate(body)).toBe(true)
      expect(body).toContain('<rss version="2.0"')
      expect(body).toContain('<title>Goosebumps.fm Mixes</title>')
      expect(body).toContain('<title>Published &amp; valid mix</title>')
      expect(body).toContain(`<link>https://goosebumps.fm/mixes/${slug}</link>`)
      expect(body).toContain(
        '<enclosure url="https://example.com/published.mp3?source=rss&amp;format=mp3" type="audio/mpeg" />',
      )
      expect(body.indexOf('<title>Published &amp; valid mix</title>')).toBeLessThan(
        body.indexOf('<title>Older published mix</title>'),
      )
    } finally {
      await db.delete(audioTable).where(inArray(audioTable.slug, [slug, olderSlug]))
    }
  })

  it('GET /robots.txt returns 200 plain text pointing at the sitemap', async () => {
    const res = await webHandler.handler(new Request('http://localhost/robots.txt'))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const body = await res.text()
    expect(body).toContain('Sitemap:')
    expect(body).toContain('/sitemap.xml')
  })

  it('GET /sitemap.xml returns 200 XML with a urlset root', async () => {
    const res = await webHandler.handler(new Request('http://localhost/sitemap.xml'))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/xml')
    const body = await res.text()
    expect(body).toContain('<urlset')
  })

  it('serves one canonical metadata projection through the API and legacy share document', async () => {
    const suffix = crypto.randomUUID()
    const slug = `metadata-mix-${suffix}`
    await db.insert(audioTable).values({
      title: 'Metadata mix',
      description: 'A mix with one canonical metadata model.',
      slug,
      content: '',
      type: 'mix',
      url: 'https://audio.example.com/metadata-mix.mp3',
      draft: false,
    })

    try {
      const [metadataResponse, cardResponse, shareResponse] = await Promise.all([
        webHandler.handler(new Request(`http://localhost/api/site-metadata/mix/${slug}`)),
        webHandler.handler(new Request(`http://localhost/api/social-cards/mix/${slug}`)),
        webHandler.handler(new Request(`http://localhost/s/mix/${slug}`)),
      ])

      const metadata = await decodeResponseBody(SiteMetadata, metadataResponse)
      const card = await decodeResponseBody(SocialCardPresentation, cardResponse)
      const shareHtml = await shareResponse.text()

      expect(metadataResponse.status).toBe(200)
      expect(metadata).toMatchObject({
        kind: 'mix',
        title: 'Metadata mix',
        description:
          'Metadata mix. Listen to the DJ mix on goosebumps.fm (gbfm). A mix with one canonical metadata model.',
        canonicalUrl: `http://127.0.0.1:5173/mixes/${slug}`,
        image: {
          url: card.images.openGraph,
          width: 1200,
          height: 630,
        },
        audio: { url: 'https://audio.example.com/metadata-mix.mp3' },
      })
      expect(card).toMatchObject({
        model: {
          kind: 'mix',
          title: 'Metadata mix',
        },
      })
      expect(shareResponse.status).toBe(200)
      expect(shareHtml).toContain(`<meta property="og:url" content="${metadata.canonicalUrl}">`)
      expect(shareHtml).toContain(`<link rel="canonical" href="${metadata.canonicalUrl}">`)
    } finally {
      await db.delete(audioTable).where(eq(audioTable.slug, slug))
    }
  })

  it('GET /s/mix/:slug returns 404 HTML for an unknown mix', async () => {
    const res = await webHandler.handler(new Request('http://localhost/s/mix/does-not-exist'))

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('GET /s/track/:slug returns 404 HTML for an unknown track', async () => {
    const res = await webHandler.handler(new Request('http://localhost/s/track/does-not-exist'))

    expect(res.status).toBe(404)
  })

  it('GET /s/show/:slug returns 404 HTML for an unknown show', async () => {
    const res = await webHandler.handler(new Request('http://localhost/s/show/does-not-exist'))

    expect(res.status).toBe(404)
  })

  it('GET /s/profile/:username returns 404 HTML for an unknown username', async () => {
    const res = await webHandler.handler(new Request('http://localhost/s/profile/does-not-exist'))

    expect(res.status).toBe(404)
  })

  it('GET /s/release/:slug returns 404 HTML for an unknown release', async () => {
    const res = await webHandler.handler(new Request('http://localhost/s/release/does-not-exist'))

    expect(res.status).toBe(404)
  })

  it('GET /s/label/:slug returns 404 HTML for an unknown label', async () => {
    const res = await webHandler.handler(new Request('http://localhost/s/label/does-not-exist'))

    expect(res.status).toBe(404)
  })

  it('GET /s/post/:slug, /s/editorial/:slug, and /s/tweet/:slug all reach the same handler and 404 for an unknown post', async () => {
    const [post, editorial, tweet] = await Promise.all([
      webHandler.handler(new Request('http://localhost/s/post/does-not-exist')),
      webHandler.handler(new Request('http://localhost/s/editorial/does-not-exist')),
      webHandler.handler(new Request('http://localhost/s/tweet/does-not-exist')),
    ])

    expect(post.status).toBe(404)
    expect(editorial.status).toBe(404)
    expect(tweet.status).toBe(404)
  })

  it('GET /s/:slug (catch-all) returns 404 HTML for an unresolvable slug', async () => {
    const res = await webHandler.handler(new Request('http://localhost/s/does-not-exist'))

    expect(res.status).toBe(404)
  })

  it('GET /s/:slug does not shadow the specific /s/mix/:slug route (static routes win over the catch-all)', async () => {
    // Both 404 (unknown slug either way), but the point is /s/mix/foo must be
    // routed to shareMix, not fall through to shareSlug's ResolveService path
    // -- confirmed indirectly: shareMix's 404 message differs from shareSlug's.
    const res = await webHandler.handler(new Request('http://localhost/s/mix/does-not-exist'))
    const body = await res.text()

    expect(res.status).toBe(404)
    expect(body).toContain('Mix not found')
  })
})

describe('POST /api/content/posts/preview', () => {
  it('requires a creator session, bounds source size, and returns resolved content', async () => {
    const preview = (content: string, token?: string) => {
      const headers = new Headers({ 'content-type': 'application/json' })

      if (token) headers.set('authorization', `Bearer ${token}`)

      return webHandler.handler(
        new Request('http://localhost/api/content/posts/preview', {
          method: 'POST',
          headers,
          body: JSON.stringify({ content }),
        }),
      )
    }

    expect((await preview('Draft')).status).toBe(401)

    const responses: Array<Response> = []

    for (const role of ['listener', 'creator']) {
      const userId = `preview-${role}-${crypto.randomUUID()}`
      const token = `token-${userId}`
      await db
        .insert(user)
        .values({ id: userId, name: role, email: `${userId}@example.test`, role })
      await db.insert(session).values({
        id: crypto.randomUUID(),
        userId,
        token,
        expiresAt: new Date(Date.now() + 60_000),
      })

      try {
        const response = await preview('::media{url="https://youtu.be/preview123"}', token)
        expect(response.status).toBe(role === 'creator' ? 200 : 403)
        responses.push(response)
        expect((await preview('x'.repeat(100 * 1024 + 1), token)).status).toBe(400)
      } finally {
        await db.delete(user).where(eq(user.id, userId))
      }
    }

    const creatorResponse = responses[1]
    assert(creatorResponse, 'Creator preview returned a response')
    const body = await decodeResponseBody(PreviewPostContentResponse, creatorResponse)
    expect(body.richContent.blocks).toHaveLength(1)
    expect(body.richContent.blocks[0]).toHaveProperty('_tag', 'ExternalMediaEmbed')
    expect(body.richContent.blocks[0]).toHaveProperty(
      'embedUrl',
      'https://www.youtube-nocookie.com/embed/preview123',
    )
  })
})

describe('POST /api/content/post server-generated slug (Slice 9)', () => {
  it('generates a slug server-side when the client omits one', async () => {
    const suffix = crypto.randomUUID()
    const userId = `create-no-slug-${suffix}`
    const token = `create-no-slug-token-${suffix}`

    await db.insert(user).values({
      id: userId,
      name: 'Creator',
      email: `${userId}@example.com`,
      role: 'creator',
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    let createdSlug: string | undefined

    try {
      const res = await webHandler.handler(
        new Request('http://localhost/api/content/post', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            title: `No slug supplied ${suffix}`,
            content: 'created without a client-supplied slug',
            type: 'post',
          }),
        }),
      )

      expect(res.status).toBe(200)
      const body = await decodeResponseBody(PostResponse, res)
      expect(body.slug.length).toBeGreaterThan(0)
      createdSlug = body.slug

      const fetchRes = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/${body.slug}`),
      )

      expect(fetchRes.status).toBe(200)
    } finally {
      if (createdSlug) {
        const [createdPost] = await db
          .select({ id: postsTable.id })
          .from(postsTable)
          .where(eq(postsTable.slug, createdSlug))
          .limit(1)

        if (createdPost) {
          await db.delete(postCreators).where(eq(postCreators.postId, createdPost.id))
        }

        await db.delete(postsTable).where(eq(postsTable.slug, createdSlug))
      }

      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('still accepts a client-supplied slug', async () => {
    const suffix = crypto.randomUUID()
    const userId = `create-with-slug-${suffix}`
    const token = `create-with-slug-token-${suffix}`
    const slug = `client-supplied-slug-${suffix}`

    await db.insert(user).values({
      id: userId,
      name: 'Creator',
      email: `${userId}@example.com`,
      role: 'creator',
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    try {
      const res = await webHandler.handler(
        new Request('http://localhost/api/content/post', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            slug,
            title: `Client slug ${suffix}`,
            content: 'created with a client-supplied slug',
            type: 'post',
          }),
        }),
      )

      expect(res.status).toBe(200)
      const body = await decodeResponseBody(PostResponse, res)
      expect(body.slug).toBe(slug)
    } finally {
      const [createdPost] = await db
        .select({ id: postsTable.id })
        .from(postsTable)
        .where(eq(postsTable.slug, slug))
        .limit(1)

      if (createdPost) {
        await db.delete(postCreators).where(eq(postCreators.postId, createdPost.id))
      }

      await db.delete(postsTable).where(eq(postsTable.slug, slug))
      await db.delete(user).where(eq(user.id, userId))
    }
  })
})

describe('quote-tweet (quotedPostId)', () => {
  it('creates a top-level post quoting an existing micro post and exposes quotedPostId', async () => {
    const suffix = crypto.randomUUID()
    const userId = `quote-create-${suffix}`
    const token = `quote-create-token-${suffix}`
    const quotedSlug = `quoted-tweet-${suffix}`

    await db.insert(user).values({
      id: userId,
      name: 'Creator',
      email: `${userId}@example.com`,
      role: 'creator',
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const [quotedPost] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: quotedSlug,
        content: 'The original tweet being quoted',
        type: 'micro',
        draft: false,
      })
      .returning()

    if (!quotedPost) throw new Error('Failed to seed quoted tweet')

    let createdSlug: string | undefined

    try {
      const res = await webHandler.handler(
        new Request('http://localhost/api/content/post', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            slug: `quoting-tweet-${suffix}`,
            content: 'quoting another tweet',
            type: 'micro',
            quotedPostId: quotedPost.id,
          }),
        }),
      )

      expect(res.status).toBe(200)
      const body = await decodeResponseBody(PostResponse, res)
      createdSlug = body.slug
      expect(body.quotedPostId).toBe(quotedPost.id)
    } finally {
      if (createdSlug) {
        const [createdPost] = await db
          .select({ id: postsTable.id })
          .from(postsTable)
          .where(eq(postsTable.slug, createdSlug))
          .limit(1)

        if (createdPost) {
          await db.delete(postCreators).where(eq(postCreators.postId, createdPost.id))
        }

        await db.delete(postsTable).where(eq(postsTable.slug, createdSlug))
      }

      await db.delete(postsTable).where(eq(postsTable.id, quotedPost.id))
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('creates a reply quoting an existing micro post', async () => {
    const suffix = crypto.randomUUID()
    const userId = `quote-reply-${suffix}`
    const token = `quote-reply-token-${suffix}`
    const parentSlug = `quote-reply-parent-${suffix}`
    const quotedSlug = `quote-reply-quoted-${suffix}`

    await db.insert(user).values({ id: userId, name: 'User', email: `${userId}@example.com` })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const [parentPost] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: parentSlug,
        content: 'Parent tweet',
        type: 'micro',
        draft: false,
      })
      .returning()

    if (!parentPost) throw new Error('Failed to seed parent tweet')
    await db.insert(postCreators).values({ postId: parentPost.id, creatorId: userId })

    const [quotedPost] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug: quotedSlug,
        content: 'A tweet to be quoted in a reply',
        type: 'micro',
        draft: false,
      })
      .returning()

    if (!quotedPost) throw new Error('Failed to seed quoted tweet')

    let replyId: string | undefined

    try {
      const res = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${parentSlug}/replies`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            content: 'replying with a quote',
            quotedPostId: quotedPost.id,
          }),
        }),
      )

      expect(res.status).toBe(200)
      const body = await decodeResponseBody(CompiledMicroPostResponse, res)
      replyId = body.id
      expect(body.quotedPostId).toBe(quotedPost.id)
    } finally {
      if (replyId) {
        await db.delete(postCreators).where(eq(postCreators.postId, replyId))
      }

      await db.delete(postCreators).where(eq(postCreators.postId, parentPost.id))
      await db.delete(postsTable).where(eq(postsTable.rootPostId, parentPost.id))
      await db.delete(postsTable).where(eq(postsTable.id, parentPost.id))
      await db.delete(postsTable).where(eq(postsTable.id, quotedPost.id))
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('404s when quoting a nonexistent post id', async () => {
    const suffix = crypto.randomUUID()
    const userId = `quote-missing-${suffix}`
    const token = `quote-missing-token-${suffix}`
    const fakeQuotedId = crypto.randomUUID()

    await db.insert(user).values({
      id: userId,
      name: 'Creator',
      email: `${userId}@example.com`,
      role: 'creator',
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    try {
      const res = await webHandler.handler(
        new Request('http://localhost/api/content/post', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            slug: `quote-missing-post-${suffix}`,
            content: 'quoting a post that does not exist',
            type: 'micro',
            quotedPostId: fakeQuotedId,
          }),
        }),
      )

      expect(res.status).toBe(404)
    } finally {
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('422s when quoting an editorial post (type != micro)', async () => {
    const suffix = crypto.randomUUID()
    const userId = `quote-editorial-${suffix}`
    const token = `quote-editorial-token-${suffix}`
    const editorialSlug = `quote-editorial-target-${suffix}`

    await db.insert(user).values({
      id: userId,
      name: 'Creator',
      email: `${userId}@example.com`,
      role: 'creator',
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const [editorialPost] = await db
      .insert(postsTable)
      .values({
        title: 'An editorial post',
        slug: editorialSlug,
        content: 'Editorial body',
        type: 'post',
        draft: false,
      })
      .returning()

    if (!editorialPost) throw new Error('Failed to seed editorial post')

    try {
      const res = await webHandler.handler(
        new Request('http://localhost/api/content/post', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            slug: `quote-editorial-post-${suffix}`,
            content: 'quoting an editorial post',
            type: 'micro',
            quotedPostId: editorialPost.id,
          }),
        }),
      )

      expect(res.status).toBe(422)
    } finally {
      await db.delete(postsTable).where(eq(postsTable.id, editorialPost.id))
      await db.delete(user).where(eq(user.id, userId))
    }
  })
})

describe('GET /api/content/posts/micro/:slug', () => {
  it('returns the rich-content tweet with creators and projected labels', async () => {
    const suffix = crypto.randomUUID()
    const userId = `micro-by-slug-${suffix}`
    const slug = `micro-by-slug-${suffix}`
    await db.insert(user).values({
      id: userId,
      name: 'Tweet Author',
      username: `tweet-author-${suffix}`,
      email: `${userId}@example.com`,
    })

    const [post] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug,
        content: 'Fetchable **tweet**',
        type: 'micro',
        draft: false,
      })
      .returning()

    if (!post) throw new Error('Failed to seed post')
    await db.insert(postCreators).values({ postId: post.id, creatorId: userId })
    await replaceEntityLabels(db, 'post', post.id, { tags: ['performance'] })

    try {
      const res = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/${slug}`),
      )

      expect(res.status).toBe(200)
      const body = await decodeResponseBody(CompiledMicroPostResponse, res)
      expect(body).toMatchObject({
        id: post.id,
        slug,
        tags: ['performance'],
        creators: [{ id: userId, name: 'Tweet Author', username: `tweet-author-${suffix}` }],
      })
      expect(body.compiledContent).toBe('')
      expect(body.richContent?.version).toBe(1)
      const block = body.richContent?.blocks[0]
      expect(block?._tag).toBe('Paragraph')

      if (block?._tag !== 'Paragraph') throw new Error('Expected paragraph content')
      expect(block.children[0]).toMatchObject({ value: 'Fetchable ' })
      expect(block.children[1]?._tag).toBe('Strong')
    } finally {
      await db.delete(entityLabelsTable).where(eq(entityLabelsTable.entityId, post.id))
      await db.delete(postCreators).where(eq(postCreators.postId, post.id))
      await db.delete(postsTable).where(eq(postsTable.id, post.id))
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('404s for an unknown slug', async () => {
    const res = await webHandler.handler(
      new Request(`http://localhost/api/content/posts/micro/does-not-exist-${crypto.randomUUID()}`),
    )

    expect(res.status).toBe(404)
  })
})

describe('GET /api/social-cards/tweet/:slug', () => {
  it('combines the tweet, creator, and music entity into revisioned image URLs', async () => {
    const suffix = crypto.randomUUID()
    const userId = `share-presentation-${suffix}`
    const slug = `share-presentation-${suffix}`
    const trackId = crypto.randomUUID()
    await db.insert(user).values({
      id: userId,
      name: 'Share Author',
      username: `share-author-${suffix}`,
      image: 'https://cdn.goosebumps.fm/user-content/share-author.png',
      email: `${userId}@example.com`,
    })
    await db.insert(musicTracksTable).values({
      id: trackId,
      title: 'A Different Track',
      slug: `different-track-${suffix}`,
      artistNames: ['Artist One', 'Artist Two'],
      coverImageUrl: 'https://cdn.goosebumps.fm/user-content/different-track.png',
    })

    const [post] = await db
      .insert(postsTable)
      .values({
        title: 'This commentary identifies the rendered card',
        slug,
        type: 'micro',
        draft: false,
        musicEntityType: 'track',
        musicEntityId: trackId,
      })
      .returning()

    if (!post) throw new Error('Failed to seed post')
    await db.insert(postCreators).values({ postId: post.id, creatorId: userId })

    try {
      const metadataResponse = await webHandler.handler(
        new Request(`http://localhost/api/site-metadata/tweet/${slug}`),
      )

      expect(metadataResponse.status).toBe(200)
      const metadata = await decodeResponseBody(SiteMetadata, metadataResponse)

      const response = await webHandler.handler(
        new Request(`http://localhost/api/social-cards/tweet/${slug}`),
      )

      expect(response.status).toBe(200)
      const body = await decodeResponseBody(TweetCardPresentation, response)
      expect(body.model).toMatchObject({
        commentary: 'This commentary identifies the rendered card',
        authorName: 'Share Author',
        username: `share-author-${suffix}`,
        avatarUrl: 'https://cdn.goosebumps.fm/user-content/share-author.png',
        entityLabel: 'Track',
        entityTitle: 'A Different Track',
        entityArtists: 'Artist One, Artist Two',
        coverImageUrl: 'https://cdn.goosebumps.fm/user-content/different-track.png',
      })
      expect(body.images.openGraph).toBe(
        `https://goosebumps.fm/social/cards/tweet/${slug}/${body.revision}/open-graph.png`,
      )
      expect(metadata.image.url).toBe(body.images.openGraph)
      expect(metadata.title).toContain('This commentary identifies the rendered card')
      const mosaicUrl = 'https://cdn.goosebumps.fm/user-content/public/fixture/mosaic.png'
      await db.update(postsTable).set({ thumbnailUrl: mosaicUrl }).where(eq(postsTable.id, post.id))

      const mosaicResponse = await webHandler.handler(
        new Request(`http://localhost/api/social-cards/tweet/${slug}`),
      )

      expect(mosaicResponse.status).toBe(200)
      const mosaic = await decodeResponseBody(TweetCardPresentation, mosaicResponse)
      expect(mosaic.model.coverImageUrl).toBe(mosaicUrl)
      expect(mosaic.model.entityTitle).toBe(body.model.entityTitle)
      expect(mosaic.revision).not.toBe(body.revision)

      const updatedMetadata = await webHandler.handler(
        new Request(`http://localhost/api/site-metadata/tweet/${slug}`),
      )

      expect((await decodeResponseBody(SiteMetadata, updatedMetadata)).image.url).toBe(
        mosaic.images.openGraph,
      )
    } finally {
      await db.delete(postCreators).where(eq(postCreators.postId, post.id))
      await db.delete(postsTable).where(eq(postsTable.id, post.id))
      await db.delete(musicTracksTable).where(eq(musicTracksTable.id, trackId))
      await db.delete(user).where(eq(user.id, userId))
    }
  })
})

describe('GET /api/content/posts/micro/by-id/:id', () => {
  it('returns the post by id', async () => {
    const suffix = crypto.randomUUID()
    const slug = `by-id-lookup-${suffix}`

    const [post] = await db
      .insert(postsTable)
      .values({
        title: null,
        slug,
        content: 'Fetchable by id',
        type: 'micro',
        draft: false,
      })
      .returning()

    if (!post) throw new Error('Failed to seed post')

    try {
      const res = await webHandler.handler(
        new Request(`http://localhost/api/content/posts/micro/by-id/${post.id}`),
      )

      expect(res.status).toBe(200)
      const body = await decodeResponseBody(CompiledMicroPostResponse, res)
      expect(body.id).toBe(post.id)
      expect(body.slug).toBe(slug)
    } finally {
      await db.delete(postsTable).where(eq(postsTable.id, post.id))
    }
  })

  it('404s for an unknown id', async () => {
    const res = await webHandler.handler(
      new Request(`http://localhost/api/content/posts/micro/by-id/${crypto.randomUUID()}`),
    )

    expect(res.status).toBe(404)
  })
})

describe('micro post navigation', () => {
  const seedFeed = async () => {
    const suffix = crypto.randomUUID()
    const at = (day: number) => new Date(Date.UTC(2100, 0, day))

    const values = [0, 1, 2, 3].map(
      (index) =>
        ({
          title: null,
          slug: `navigation-${index}-${suffix}`,
          content: `Navigation ${index}`,
          type: 'micro',
          draft: false,
          createdAt: at(index + 1),
        }) satisfies typeof postsTable.$inferInsert,
    )

    const inserted = await db.insert(postsTable).values(values).returning()

    const [oldest, older, middle, newest] = values.map((value) => {
      const post = inserted.find((row) => row.slug === value.slug)

      if (!post) throw new Error('Failed to seed navigation feed')

      return post
    })

    if (!oldest || !older || !middle || !newest) throw new Error('Failed to seed navigation feed')

    const hidden = await db
      .insert(postsTable)
      .values([
        {
          title: null,
          slug: `navigation-draft-${suffix}`,
          content: 'Draft',
          type: 'micro',
          draft: true,
          createdAt: new Date(Date.UTC(2100, 0, 3, 12)),
        },
        {
          title: null,
          slug: `navigation-reply-${suffix}`,
          content: 'Reply',
          type: 'micro',
          draft: false,
          parentPostId: newest.id,
          rootPostId: newest.id,
          createdAt: new Date(Date.UTC(2100, 0, 3, 18)),
        },
      ])
      .returning()

    const ids = [...inserted, ...hidden].map((post) => post.id)

    return {
      oldest,
      older,
      middle,
      newest,
      cleanup: async () => {
        await db.delete(postsTable).where(inArray(postsTable.id, ids))
      },
    }
  }

  const deviceCookie = () => `gbfm-navigation-device=navigation-device-${crypto.randomUUID()}`

  const neighbours = async (slug: string, cookie: string) => {
    const res = await webHandler.handler(
      new Request(`http://localhost/api/content/posts/micro/${slug}/neighbours`, {
        headers: { cookie },
      }),
    )

    expect(res.status).toBe(200)

    return decodeResponseBody(MicroPostNeighboursResponse, res)
  }

  const markSeen = (slug: string, headers: Record<string, string>) =>
    webHandler.handler(
      new Request(`http://localhost/api/content/posts/micro/${slug}/seen`, {
        method: 'POST',
        headers,
      }),
    )

  it('orders neighbours by date and skips drafts and replies', async () => {
    const feed = await seedFeed()

    try {
      const middle = await neighbours(feed.middle.slug, deviceCookie())
      expect(middle).toMatchObject({
        newer: feed.newest.slug,
        older: feed.older.slug,
        seen: false,
        olderUnread: feed.older.slug,
      })
      const totalFeed = middle.timeline.reduce((sum, month) => sum + month.total, 0)
      expect(middle.unreadCount).toBe(totalFeed - 1)
      expect(middle.timeline.at(-1)).toEqual({
        month: '2100-01',
        total: 4,
        unread: 4,
        newestSlug: feed.newest.slug,
      })
      const newest = await neighbours(feed.newest.slug, deviceCookie())
      expect(newest).toMatchObject({
        newer: null,
        older: feed.middle.slug,
      })
    } finally {
      await feed.cleanup()
    }
  })

  it('moves forward past seen tweets while back stays by date', async () => {
    const feed = await seedFeed()
    const cookie = deviceCookie()

    try {
      expect((await markSeen(feed.older.slug, { cookie })).status).toBe(200)
      expect((await markSeen(feed.newest.slug, { cookie })).status).toBe(200)
      expect((await markSeen(feed.newest.slug, { cookie })).status).toBe(200)

      const middle = await neighbours(feed.middle.slug, cookie)
      expect(middle).toMatchObject({
        newer: feed.newest.slug,
        older: feed.older.slug,
        olderUnread: feed.oldest.slug,
      })
      const totalFeed = middle.timeline.reduce((sum, month) => sum + month.total, 0)
      expect(middle.unreadCount).toBe(totalFeed - 3)
      expect(middle.timeline.at(-1)).toEqual({
        month: '2100-01',
        total: 4,
        unread: 2,
        newestSlug: feed.newest.slug,
      })
      await expect(neighbours(feed.newest.slug, cookie)).resolves.toMatchObject({ seen: true })
      await expect(neighbours(feed.middle.slug, deviceCookie())).resolves.toMatchObject({
        olderUnread: feed.older.slug,
      })
    } finally {
      await feed.cleanup()
      await db
        .delete(navigationSessions)
        .where(eq(navigationSessions.deviceToken, cookie.split('=')[1] ?? ''))
    }
  })

  it('picks a random unread tweet other than the current one', async () => {
    const feed = await seedFeed()
    const cookie = deviceCookie()

    try {
      await markSeen(feed.newest.slug, { cookie })

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await webHandler.handler(
          new Request(`http://localhost/api/content/posts/micro/${feed.middle.slug}/random`, {
            headers: { cookie },
          }),
        )

        expect(res.status).toBe(200)
        const { slug } = await decodeResponseBody(MicroPostRandomUnreadResponse, res)
        expect([feed.middle.slug, feed.newest.slug]).not.toContain(slug)
      }
    } finally {
      await feed.cleanup()
      await db
        .delete(navigationSessions)
        .where(eq(navigationSessions.deviceToken, cookie.split('=')[1] ?? ''))
    }
  })

  it('mints a device cookie for anonymous readers', async () => {
    const feed = await seedFeed()

    try {
      const res = await markSeen(feed.middle.slug, {})
      expect(res.status).toBe(200)
      const cookie = res.headers.getSetCookie()[0]?.split(';')[0]

      if (!cookie) throw new Error('Expected navigation device cookie')
      await expect(neighbours(feed.newest.slug, cookie)).resolves.toMatchObject({
        olderUnread: feed.older.slug,
      })
      await db
        .delete(navigationSessions)
        .where(eq(navigationSessions.deviceToken, cookie.split('=')[1] ?? ''))
    } finally {
      await feed.cleanup()
    }
  })

  it('records seen tweets against the signed-in user instead of the device', async () => {
    const feed = await seedFeed()
    const suffix = crypto.randomUUID()
    const userId = `navigation-user-${suffix}`
    const token = `navigation-token-${suffix}`
    await db
      .insert(user)
      .values({ id: userId, name: 'Navigation user', email: `${userId}@example.com` })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    try {
      const res = await markSeen(feed.middle.slug, {
        authorization: `Bearer ${token}`,
        cookie: 'gbfm-navigation-device=ignored-device-token',
      })

      expect(res.status).toBe(200)

      const sessions = await db
        .select()
        .from(navigationSessions)
        .where(eq(navigationSessions.userId, userId))

      expect(sessions).toHaveLength(1)
      expect(sessions[0]?.deviceToken).toBeNull()
      expect(
        await db
          .select()
          .from(navigationSessions)
          .where(eq(navigationSessions.deviceToken, 'ignored-device-token')),
      ).toEqual([])
    } finally {
      await feed.cleanup()
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('returns not found for unknown tweets', async () => {
    const slug = `navigation-missing-${crypto.randomUUID()}`

    const neighboursRes = await webHandler.handler(
      new Request(`http://localhost/api/content/posts/micro/${slug}/neighbours`),
    )

    expect(neighboursRes.status).toBe(404)
    expect((await markSeen(slug, {})).status).toBe(404)
  })
})
