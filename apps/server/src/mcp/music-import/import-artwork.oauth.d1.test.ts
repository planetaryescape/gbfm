import { eq, sql } from 'drizzle-orm'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vitest'

import { Database } from '@/db/layer'
import { musicAlbumsTable } from '@/db/music-entity.schema'
import { makeOAuthCommandAuthority } from '@/mcp/command-authority'
import { McpArtworkStoreLayer } from '@/mcp/operations/staged-store'
import { MusicCoverImageFetcher } from '@/services/canonical-music-identity/artwork-delivery'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuth } from '@/services/editorial-oauth.service'
import { S3Service } from '@/services/s3.service'
import { withTestLayer } from '@/test/effect'
import { makeTestS3Service } from '@/test/s3'

import { MusicImportArtwork, MusicImportArtworkLayer } from './artwork'
import { imported, setup } from './import-oauth.fixture'

test('staged artwork survives upload success with lost acknowledgement and resumes immutable object without fetching again', async () => {
  await using f = await setup()
  f.state.rejectUpload = true

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  const first = imported(await f.call(input)).result.structuredContent.import
  expect(first).toMatchObject({
    catalogue: { disposition: 'created' },
    completion: 'pending_artwork',
    artwork: { phase: 'uploading' },
  })
  expect(f.objects.size).toBe(1)
  expect(f.state.fetches).toBe(1)
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${first.operationId}`,
  )
  f.state.rejectUpload = false
  await f.restart()
  const replay = imported(await f.call(input)).result.structuredContent.import
  expect(replay).toMatchObject({
    receipt: 'replayed',
    catalogue: first.catalogue,
    artwork: { phase: 'delivered', associatedRevision: first.catalogue.revision + 1 },
  })
  expect(f.state.fetches).toBe(1)
  expect(f.state.puts).toBe(1)
  expect(f.state.scrapes).toBe(1)
}, 30000)

test('upload success with failed database association remains association_pending and recovers after receipt expiry', async () => {
  await using f = await setup()
  f.state.failAssociation = true

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'best_effort' as const,
  }

  const first = imported(await f.call(input)).result.structuredContent.import
  expect(first.artwork.phase).toBe('association_pending')
  await f.fixture.database.prepare('DROP TRIGGER reject_import_artwork').run()
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${first.operationId}`,
  )
  const created = Date.now() - 86400001
  await f.fixture.db.run(
    sql`UPDATE mcp_operations SET created_at = ${created}, expires_at = ${created + 86400000} WHERE id = ${first.operationId}`,
  )
  const response = await f.call(input)
  expect(JSON.stringify(response)).not.toContain('"isError":true')
  const replay = imported(response).result.structuredContent.import
  expect(replay).toMatchObject({
    receipt: 'expired',
    catalogue: first.catalogue,
    artwork: { phase: 'delivered' },
  })
  expect(f.state.puts).toBe(1)
  expect(f.state.fetches).toBe(1)
}, 30000)

test('required fetch unavailability stays pending; frozen artifact mismatch fails without replaying a different upload', async () => {
  await using f = await setup()

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  f.state.fetchUnavailable = true
  const pending = imported(await f.call(input)).result.structuredContent.import
  expect(pending.artwork.phase).toBe('pending')
  expect(f.state.puts).toBe(0)
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${pending.operationId}`,
  )
  f.state.fetchUnavailable = false
  f.state.discardUpload = true
  const frozen = imported(await f.call(input)).result.structuredContent.import
  expect(frozen.artwork.phase).toBe('uploading')
  expect(f.state.puts).toBe(1)
  expect(f.objects.size).toBe(0)
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${pending.operationId}`,
  )
  f.state.discardUpload = false
  f.state.bytes = new Uint8Array([4, 5, 6])
  const mismatch = imported(await f.call(input)).result.structuredContent.import
  expect(mismatch).toMatchObject({
    catalogue: pending.catalogue,
    artwork: { phase: 'failed', failureCode: 'artifact_rejected' },
  })
  expect(f.state.puts).toBe(1)
}, 30000)

test('a later catalogue edit prevents artwork association without rebasing the original import revision', async () => {
  await using f = await setup()
  f.state.failAssociation = true

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  const first = imported(await f.call(input)).result.structuredContent.import
  await f.fixture.database.prepare('DROP TRIGGER reject_import_artwork').run()
  await f.fixture.db
    .update(musicAlbumsTable)
    .set({
      revision: first.catalogue.revision + 1,
      title: 'Later administrator edit',
      coverImageUrl: 'https://i.scdn.co/image/later-edit',
    })
    .where(eq(musicAlbumsTable.id, first.catalogue.entityId))
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${first.operationId}`,
  )
  const stale = imported(await f.call(input)).result.structuredContent.import
  expect(stale).toMatchObject({
    catalogue: first.catalogue,
    completion: 'partial',
    artwork: { phase: 'failed', failureCode: 'stale_revision' },
  })
  expect(
    (
      await f.fixture.db
        .select()
        .from(musicAlbumsTable)
        .where(eq(musicAlbumsTable.id, first.catalogue.entityId))
    )[0],
  ).toMatchObject({
    title: 'Later administrator edit',
    coverImageUrl: 'https://i.scdn.co/image/later-edit',
  })
}, 30000)

test('an actual upload timeout cancels waiting but retains the frozen recoverable stage', async () => {
  await using f = await setup()
  f.state.discardUpload = true

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  const first = imported(await f.call(input)).result.structuredContent.import
  await f.fixture.db.run(
    sql`UPDATE mcp_operation_artwork SET lease_expires_at = 0 WHERE operation_id = ${first.operationId}`,
  )
  const principal = await Effect.runPromise(f.fixture.service.verify(f.tokens.access_token))

  const authority = await Effect.runPromise(
    makeOAuthCommandAuthority(f.tokens.access_token, principal).pipe(
      Effect.provideService(Database, f.fixture.db),
      Effect.provideService(ConfigService, f.fixture.config),
      Effect.provideService(EditorialOAuth, f.fixture.service),
    ),
  )

  const started = await Effect.runPromise(Deferred.make<void>())
  let cancelled = false

  const storage = makeTestS3Service(() =>
    Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          cancelled = true
        }),
      ),
    ),
  )

  const layer = MusicImportArtworkLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Database, f.fixture.db),
        Layer.succeed(ConfigService, f.fixture.config),
        Layer.succeed(S3Service, storage),
        Layer.succeed(
          MusicCoverImageFetcher,
          async () =>
            new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }),
        ),
        McpArtworkStoreLayer(f.fixture.database),
      ),
    ),
  )

  const result = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.now())
        const artwork = yield* MusicImportArtwork

        const task = yield* artwork
          .run(
            {
              key: {
                actorId: principal.userId,
                clientId: principal.clientId,
                resource: f.fixture.config.mcp.resourceUrl,
                operation: 'import_music_url',
                requestId: input.requestId,
              },
              normalizedInput: {
                url: input.url,
                expectedType: input.expectedType,
                artworkDelivery: input.artworkDelivery,
              },
              sourceKey: first.catalogue.sourceKey,
              checkpoint: () =>
                authority.checkpoint(['catalogue:write', 'catalogue:import', 'providers:read']),
            },
            true,
          )
          .pipe(Effect.forkScoped)

        yield* Deferred.await(started)
        yield* TestClock.adjust('12 seconds')

        return yield* Fiber.join(task)
      }).pipe(Effect.scoped),
      Layer.mergeAll(layer, TestClock.layer()),
    ),
  )

  expect(result.phase).toBe('uploading')
  expect(cancelled).toBe(true)
  expect(f.objects.size).toBe(0)
  expect(
    imported(await f.call(input, 'get_music_import_status')).result.structuredContent.import
      .catalogue,
  ).toEqual(first.catalogue)
}, 30000)

test('artist and track imports deliver artwork with native entity references and separate association revisions', async () => {
  await using f = await setup()

  for (const type of ['artist', 'track'] as const) {
    f.state.metadataType.value = type === 'track' ? 'song' : 'artist'
    const id = crypto.randomUUID().replaceAll('-', '')

    const result = imported(
      await f.call({
        requestId: crypto.randomUUID(),
        url: `https://open.spotify.com/${type}/${id}`,
        expectedType: type,
        artworkDelivery: 'required',
      }),
    ).result.structuredContent.import

    expect(result).toMatchObject({
      catalogue: { disposition: 'created', entityType: type, sourceKey: `spotify:${type}:${id}` },
      artwork: { phase: 'delivered', associatedRevision: result.catalogue.revision + 1 },
    })

    const reused = imported(
      await f.call({
        requestId: crypto.randomUUID(),
        url: `https://open.spotify.com/${type}/${id}`,
        expectedType: type,
        artworkDelivery: 'required',
      }),
    ).result.structuredContent.import

    expect(reused).toMatchObject({
      catalogue: {
        disposition: 'reused',
        entityType: type,
        entityId: result.catalogue.entityId,
        revision: result.artwork.associatedRevision,
      },
      artwork: { phase: 'delivered' },
    })
  }
}, 30000)

test.each(['declared_oversize', 'streamed_oversize'] as const)(
  'oversized artwork is terminally rejected through the import service: %s',
  async (mode) => {
    await using f = await setup()
    f.state.artworkBody.mode = mode

    const input = {
      requestId: crypto.randomUUID(),
      url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
      expectedType: 'album' as const,
      artworkDelivery: 'required' as const,
    }

    const first = imported(await f.call(input)).result.structuredContent.import
    expect(first).toMatchObject({
      completion: 'partial',
      catalogue: { disposition: 'created' },
      artwork: { phase: 'failed', failureCode: 'artifact_rejected' },
    })
    expect(f.state.fetches).toBe(1)
    expect(f.state.puts).toBe(0)
    const replay = imported(await f.call(input)).result.structuredContent.import
    expect(replay).toEqual({ ...first, receipt: 'replayed' })
    expect(f.state.fetches).toBe(1)
    expect(f.state.puts).toBe(0)
  },
  30000,
)

test('a genuine artwork body-stream failure remains recoverable rather than becoming artifact rejection', async () => {
  await using f = await setup()
  f.state.artworkBody.mode = 'stream_failure'

  const input = {
    requestId: crypto.randomUUID(),
    url: `https://open.spotify.com/album/${crypto.randomUUID().replaceAll('-', '')}`,
    expectedType: 'album' as const,
    artworkDelivery: 'required' as const,
  }

  const result = imported(await f.call(input)).result.structuredContent.import
  expect(result).toMatchObject({
    completion: 'pending_artwork',
    artwork: { phase: 'pending', failureCode: null },
  })
  expect(f.state.puts).toBe(0)
}, 30000)
