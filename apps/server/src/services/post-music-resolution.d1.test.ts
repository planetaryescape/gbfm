import { MusicServiceUnavailableResponse } from '@gbfm/api/errors'
import { eq } from 'drizzle-orm'
import { Effect, Exit, Layer, Match } from 'effect'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database, makeDatabaseClient } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { ConflictError, UnauthorizedError } from '@/errors'
import { mapMusicIdentityErrors } from '@/http/music-identity-http'
import { CanonicalMusicIdentityLayer } from '@/services/canonical-music-identity'
import { MusicCoverImageFetcher } from '@/services/canonical-music-identity/artwork-delivery'
import { ConfigService, createConfig } from '@/services/config.service'
import { MusicLinkScraperService, MusicScraperError } from '@/services/music-link-scraper.service'
import { S3Service } from '@/services/s3.service'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'
import { makeTestS3Service } from '@/test/s3'

import { resolvePostMusic } from './post-music-resolution'

test('provider failure, concurrent edits and revoked authorship preserve the saved post', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await seedMusicLookups(db)
  await db
    .insert(user)
    .values({ id: 'owner', email: 'owner@example.test', name: 'Owner', role: 'creator' })
  const postId = crypto.randomUUID()
  await db.insert(postsTable).values({
    id: postId,
    title: 'Draft',
    content: 'Keep this',
    slug: 'draft',
    type: 'micro',
    draft: true,
  })
  await db.insert(postCreators).values({ postId, creatorId: 'owner' })
  const actor = { userId: 'owner', userRole: 'creator' }

  for (const mode of ['throttled', 'concurrent', 'revoked'] as const) {
    const url = `https://open.spotify.com/track/${mode}`

    const scraper = Layer.succeed(MusicLinkScraperService, {
      scrape: () =>
        mode === 'throttled'
          ? Effect.fail(
              new MusicScraperError({
                provider: 'odesli',
                statusCode: 429,
                message: 'Provider secret must not leak',
              }),
            )
          : Effect.promise(async () => {
              if (mode === 'revoked') {
                await db.delete(postCreators).where(eq(postCreators.postId, postId))
              } else {
                await db
                  .update(postsTable)
                  .set({
                    musicEntityType: 'track',
                    musicEntityId: 'chosen-by-another-edit',
                    updatedAt: new Date(Date.now() + 1000),
                  })
                  .where(eq(postsTable.id, postId))
              }

              return {
                links: [{ platform: 'spotify' as const, url, scrapedAt: new Date() }],
                entityMeta: {
                  title: 'Resolved track',
                  artistName: 'Artist',
                  type: 'song' as const,
                },
              }
            }),
      discoverCrossPlatformLinks: () => Effect.succeed({ links: [] }),
    })

    const identity = CanonicalMusicIdentityLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Database, db),
          scraper,
          Layer.succeed(ConfigService, createConfig()),
          Layer.succeed(S3Service, makeTestS3Service()),
          Layer.succeed(MusicCoverImageFetcher, fetch),
        ),
      ),
    )

    const error = await Effect.runPromise(
      withTestLayer(
        mapMusicIdentityErrors(resolvePostMusic(postId, actor, url)).pipe(
          Effect.provideService(Database, db),
          Effect.flip,
        ),
        identity,
      ),
    )

    const expected = Match.value(mode).pipe(
      Match.when('throttled', () => ({
        type: MusicServiceUnavailableResponse,
        fields: { retryAfterSeconds: 30 },
      })),
      Match.when('revoked', () => ({
        type: UnauthorizedError,
        fields: { message: 'Not authorized to modify this resource' },
      })),
      Match.when('concurrent', () => ({
        type: ConflictError,
        fields: { message: 'The post changed during resolution. Reload and try again.' },
      })),
      Match.exhaustive,
    )

    expect(error).toBeInstanceOf(expected.type)
    expect(error).toMatchObject(expected.fields)
    expect(JSON.stringify(error)).not.toContain('secret')

    expect((await db.select().from(postsTable).where(eq(postsTable.id, postId)))[0]).toMatchObject({
      content: 'Keep this',
      draft: true,
      musicEntityId: mode === 'throttled' ? null : 'chosen-by-another-edit',
    })
  }
}, 30_000)

test('successful resolution only attaches music and interrupted provider work cannot change that attachment', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await seedMusicLookups(db)
  await db
    .insert(user)
    .values({ id: 'owner', email: 'owner@example.test', name: 'Owner', role: 'creator' })

  const [post] = await db
    .insert(postsTable)
    .values({ title: 'Draft', content: 'Keep this', slug: 'draft', type: 'micro', draft: true })
    .returning()

  if (!post) throw new Error('Missing post fixture')
  await db.insert(postCreators).values({ postId: post.id, creatorId: 'owner' })

  for (const mode of ['success', 'interrupted'] as const) {
    const started = Promise.withResolvers<void>()
    const controller = new AbortController()
    const url = `https://open.spotify.com/track/${mode}`

    const layer = CanonicalMusicIdentityLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Database, db),
          Layer.succeed(MusicLinkScraperService, {
            scrape: () =>
              Effect.gen(function* () {
                started.resolve()

                if (mode === 'interrupted') return yield* Effect.never

                return {
                  links: [],
                  entityMeta: { title: 'Resolved track', type: 'song' as const },
                }
              }),
            discoverCrossPlatformLinks: () => Effect.succeed({ links: [] }),
          }),
          Layer.succeed(ConfigService, createConfig()),
          Layer.succeed(S3Service, makeTestS3Service()),
          Layer.succeed(MusicCoverImageFetcher, fetch),
        ),
      ),
    )

    const [before] = await db.select().from(postsTable).where(eq(postsTable.id, post.id))

    const pending = Effect.runPromiseExit(
      withTestLayer(
        resolvePostMusic(post.id, { userId: 'owner', userRole: 'creator' }, url).pipe(
          Effect.provideService(Database, db),
        ),
        layer,
      ),
      { signal: controller.signal },
    )

    await started.promise

    if (mode === 'interrupted') controller.abort()
    const exit = await pending
    const [after] = await db.select().from(postsTable).where(eq(postsTable.id, post.id))

    expect(Exit.hasInterrupts(exit)).toBe(mode === 'interrupted')
    expect(Exit.isSuccess(exit)).toBe(mode === 'success')
    expect(after).toEqual(
      Exit.match(exit, {
        onFailure: () => before,
        onSuccess: (value) => ({
          ...post,
          musicEntityId: value.entityId,
          musicEntityType: 'track',
          updatedAt: after?.updatedAt,
        }),
      }),
    )
  }
}, 30_000)
