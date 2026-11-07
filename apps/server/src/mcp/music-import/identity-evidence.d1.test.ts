import { eq } from 'drizzle-orm'
import { Effect, Layer, Predicate, Result } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import { Database } from '@/db/layer'
import {
  musicEntityTypesTable,
  musicPlatformsTable,
  musicSourceIdentitiesTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { S3Error } from '@/errors'
import {
  CanonicalMusicIdentity,
  CanonicalMusicIdentityLayer,
} from '@/services/canonical-music-identity'
import { MusicCoverImageFetcher } from '@/services/canonical-music-identity/artwork-delivery'
import { ConfigService, createConfig } from '@/services/config.service'
import { MusicLinkScraperService, MusicScraperError } from '@/services/music-link-scraper.service'
import { S3Service } from '@/services/s3.service'
import { db } from '@/test/d1'
import { withTestLayer } from '@/test/effect'
import { makeTestS3Service } from '@/test/s3'

import { projectImportPersistence } from './outcome'

beforeAll(async () => {
  await db
    .insert(musicEntityTypesTable)
    .values([
      { id: 'artist', displayName: 'Artist' },
      { id: 'album', displayName: 'Album' },
      { id: 'track', displayName: 'Track' },
      { id: 'playlist', displayName: 'Playlist' },
    ])
    .onConflictDoNothing()
  await db
    .insert(musicPlatformsTable)
    .values({ id: 'spotify', displayName: 'Spotify' })
    .onConflictDoNothing()
})

// Each invocation builds a fresh service against the SAME migrated local D1.
// Reuse therefore cannot be supplied by an in-memory receipt or service cache.
const resolve = (
  url: string,
  title = 'Controlled track',
  artworkDelivery: 'preserve' | 'required' = 'preserve',
) =>
  Effect.runPromise(
    withTestLayer(
      Effect.flatMap(CanonicalMusicIdentity, (identity) =>
        identity.resolveSource({
          url,
          expectedType: 'track',
          origin: 'manual',
          artworkDelivery,
        }),
      ),
      CanonicalMusicIdentityLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Database, db),
            Layer.succeed(ConfigService, createConfig()),
            Layer.succeed(MusicLinkScraperService, {
              scrape: () =>
                Effect.sleep('20 millis').pipe(
                  Effect.as({
                    links: [],
                    entityMeta: {
                      title,
                      type: 'song',
                      thumbnailUrl: 'https://i.scdn.co/image/i1-controlled',
                    },
                  }),
                ),
              discoverCrossPlatformLinks: () =>
                Effect.fail(
                  new MusicScraperError({
                    provider: 'controlled',
                    message: 'Unexpected discovery',
                  }),
                ),
            }),
            Layer.succeed(
              S3Service,
              makeTestS3Service((key) =>
                Effect.fail(
                  new S3Error({
                    message: 'Controlled unavailable storage',
                    operation: 'uploadFile',
                    key,
                  }),
                ),
              ),
            ),
            Layer.succeed(MusicCoverImageFetcher, () =>
              Promise.resolve(
                new Response(new Uint8Array([1, 2, 3]), {
                  headers: { 'content-type': 'image/jpeg' },
                }),
              ),
            ),
          ),
        ),
      ),
    ).pipe(Effect.result),
  )

test('concurrent resolutions converge in D1; lost-response retry reuses identity but cannot replay created outcome', async () => {
  const externalId = crypto.randomUUID().replaceAll('-', '')
  const url = `https://open.spotify.com/track/${externalId}`
  const results = await Promise.all(Array.from({ length: 6 }, () => resolve(url)))

  const entities = results.map((result) => {
    if (Result.isFailure(result)) throw new Error(`Unexpected ${result.failure._tag}`)

    return result.success
  })

  expect(new Set(entities.map((entity) => entity.entity.id)).size).toBe(1)
  expect(entities.filter((entity) => entity.created)).toHaveLength(1)

  const projected = await Promise.all(
    results.map((result) => Effect.runPromise(projectImportPersistence(result))),
  )

  expect(projected.filter((outcome) => outcome.status === 'created')).toHaveLength(1)
  expect(projected.filter((outcome) => outcome.status === 'reused')).toHaveLength(5)

  // Deliberately discard the first caller's result and recreate the service,
  // as a disconnected client would. Only the canonical identity survives.
  const retry = await resolve(`${url}?si=another-tracking-value`)
  expect(retry).toMatchObject({
    success: { created: false, entity: { id: entities[0]?.entity.id } },
  })
  expect(
    await db
      .select()
      .from(musicSourceIdentitiesTable)
      .where(eq(musicSourceIdentitiesTable.sourceKey, `spotify:track:${externalId}`)),
  ).toHaveLength(1)
  expect(
    await db.select().from(musicTracksTable).where(eq(musicTracksTable.id, entities[0]!.entity.id)),
  ).toHaveLength(1)
})

test('canonical source identity is not a changed-command-payload conflict receipt', async () => {
  const url = `https://open.spotify.com/track/${crypto.randomUUID().replaceAll('-', '')}`
  const first = await resolve(url, 'Original title')
  const changed = await resolve(url, 'Changed title')
  expect(first).toMatchObject({ success: { created: true, entity: { title: 'Original title' } } })
  expect(changed).toMatchObject({
    success: { created: false, entity: { title: 'Original title' } },
  })
})

test('artwork upload failure occurs after catalogue commit and leaves a recoverable entity', async () => {
  const externalId = crypto.randomUUID().replaceAll('-', '')
  const url = `https://open.spotify.com/track/${externalId}`
  const failure = await resolve(url, 'Partial track', 'required')
  expect(failure).toMatchObject({
    failure: { operation: 'upload' },
  })

  if (
    Result.isSuccess(failure) ||
    !Predicate.isTagged(failure.failure, 'MusicIdentityArtworkDeliveryFailed')
  ) {
    throw new Error('Expected artwork failure with committed reference')
  }

  const entityId = failure.failure.entityId
  expect(await Effect.runPromise(projectImportPersistence(failure))).toEqual({
    status: 'partial',
    reference: { entityType: 'track', entityId },
    disposition: 'unknown',
    artwork: 'upload_failed',
  })

  const [persisted] = await db
    .select()
    .from(musicTracksTable)
    .where(eq(musicTracksTable.id, entityId))

  expect(persisted).toMatchObject({
    title: 'Partial track',
    coverImageUrl: 'https://i.scdn.co/image/i1-controlled',
  })
  const retry = await resolve(url, 'Must not replace known-good metadata')
  expect(retry).toMatchObject({
    success: { created: false, entity: { id: entityId, title: 'Partial track' } },
  })
})
