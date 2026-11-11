import { sql } from 'drizzle-orm'
import { Deferred, Effect, Fiber, Layer, Logger, References } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { mcpOperationArtwork } from '@/db/exports'
import { Database, makeDatabaseClient } from '@/db/layer'
import {
  musicAlbumsTable,
  musicEntityTypesTable,
  musicPlatformsTable,
  musicSourceIdentitiesTable,
} from '@/db/music-entity.schema'
import { McpToolError } from '@/mcp/contracts'
import { createArtworkStageStatement, McpArtworkStoreLayer } from '@/mcp/operations/staged-store'
import { createMcpOperationStore } from '@/mcp/operations/store'
import {
  MusicCoverImageFetcher,
  type MusicCoverImageFetch,
} from '@/services/canonical-music-identity/artwork-delivery'
import type { CanonicalMusicEntityType } from '@/services/canonical-music-identity/music-source'
import { ConfigService, createConfig } from '@/services/config.service'
import { S3Service } from '@/services/s3.service'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'
import { makeTestS3Service } from '@/test/s3'

import { MusicImportArtwork, MusicImportArtworkLayer } from './artwork'

const secret = 'synthetic-private-artwork-diagnostic'

const setup = async (
  fetcher: MusicCoverImageFetch,
  deny?: (phase: string | undefined, type: CanonicalMusicEntityType | undefined) => boolean,
) => {
  const resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  const now = Date.now()

  const key = {
    actorId: `${secret}-actor`,
    clientId: `${secret}-client`,
    resource: 'https://api.example.test/mcp',
    operation: 'import_music_url',
    requestId: crypto.randomUUID(),
  }

  const sourceKey = `spotify:album:${secret.replaceAll('-', '')}`
  const entityId = `${secret}-album`
  const normalizedInput = { url: `https://open.spotify.com/album/${secret}` }

  await db.insert(user).values({ id: key.actorId, name: secret, email: `${secret}@example.test` })
  await db.insert(musicEntityTypesTable).values({ id: 'album', displayName: 'Album' })
  await db.insert(musicPlatformsTable).values({ id: 'spotify', displayName: 'Spotify' })
  await db.insert(musicAlbumsTable).values({
    id: entityId,
    title: secret,
    slug: secret,
    coverImageUrl: `https://i.scdn.co/image/${secret}`,
  })
  await db.insert(musicSourceIdentitiesTable).values({
    sourceKey,
    platform: 'spotify',
    sourceEntityType: 'album',
    canonicalUrl: normalizedInput.url,
    state: 'resolved',
    entityType: 'album',
    entityId,
    resolvedAt: new Date(now),
  })

  const committed = await createMcpOperationStore(resource.database).execute({
    key,
    normalizedInput,
    now,
    authorize: async () => true,
    build: (context) => ({
      statements: [
        createArtworkStageStatement(context, {
          disposition: 'created',
          entityType: 'album',
          entityId,
          catalogueRevision: 0,
          sourceIdentityKey: sourceKey,
          artworkPolicy: 'required',
        }),
      ],
      assertApplied: sql`1`,
      outcome: { result: {}, revision: 0, access: { entityType: 'album', entityId } },
    }),
  })

  expect(committed.status).toBe('applied')

  const logs: Array<{ message: unknown; annotations: unknown; cause: unknown }> = []

  const layer = MusicImportArtworkLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Database, db),
        Layer.succeed(ConfigService, createConfig()),
        Layer.succeed(S3Service, makeTestS3Service()),
        Layer.succeed(MusicCoverImageFetcher, fetcher),
        McpArtworkStoreLayer(resource.database),
      ),
    ),
  )

  const logging = Logger.layer([
    Logger.make(({ message, cause, fiber }) => {
      logs.push({ message, cause, annotations: fiber.getRef(References.CurrentLogAnnotations) })
    }),
  ])

  const run = Effect.gen(function* () {
    const artwork = yield* MusicImportArtwork

    return yield* artwork.run(
      {
        key,
        normalizedInput,
        sourceKey,
        checkpoint: (type) =>
          Effect.gen(function* () {
            const [stage] = yield* Effect.promise(() =>
              db.select({ phase: mcpOperationArtwork.phase }).from(mcpOperationArtwork),
            )

            if (deny?.(stage?.phase, type))
              return yield* new McpToolError({ code: 'access_denied', message: secret })

            return { ...key, liveGuard: sql`1` }
          }),
      },
      true,
    )
  })

  return { db, layer, logging, logs, run, now, [Symbol.asyncDispose]: () => resource.dispose() }
}

test.each(['network', 'provider_status', 'body_read'] as const)(
  'recoverable %s emits only bounded diagnostic fields and retains pending',
  async (reason) => {
    await using f = await setup(async () => {
      if (reason === 'network') throw new Error(`Bearer ${secret}`, { cause: { token: secret } })

      if (reason === 'provider_status') return new Response(secret, { status: 503 })

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error(secret))
          },
        }),
        { headers: { 'content-type': 'image/jpeg' } },
      )
    })

    const result = await Effect.runPromise(withTestLayer(f.run, Layer.mergeAll(f.layer, f.logging)))
    expect(result).toEqual({ phase: 'pending', associatedRevision: null, failureCode: null })
    expect(f.logs).toHaveLength(1)
    expect(f.logs[0]?.annotations).toEqual({ step: 'source_fetch', dependency: 'provider', reason })
    expect(JSON.stringify(f.logs)).toContain('mcp.music_import.artwork.recoverable')
    expect(JSON.stringify(f.logs)).not.toContain(secret)
    expect(JSON.stringify(f.logs)).not.toContain('Bearer')
  },
)

test('successful artwork delivery produces no recoverable diagnostics', async () => {
  await using f = await setup(
    async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/jpeg' },
      }),
  )

  const result = await Effect.runPromise(withTestLayer(f.run, Layer.mergeAll(f.layer, f.logging)))
  expect(result.phase).toBe('delivered')
  expect(f.logs).toEqual([])
})

test.each(['transition', 'association_postcommit'] as const)(
  'authorization denial during store %s emits no storage diagnostic',
  async (point) => {
    let fetched = false
    let denied = false

    await using f = await setup(
      async () => {
        fetched = true

        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'image/jpeg' },
        })
      },
      (phase, type) => {
        if (denied || type !== 'album') return false

        if (point === 'transition' ? phase === 'pending' && fetched : phase === 'delivered') {
          denied = true

          return true
        }

        return false
      },
    )

    const result = await Effect.runPromise(withTestLayer(f.run, Layer.mergeAll(f.layer, f.logging)))
    expect(denied).toBe(true)
    expect(result).toEqual({
      phase: point === 'transition' ? 'pending' : 'delivered',
      associatedRevision: point === 'transition' ? null : 1,
      failureCode: null,
    })

    const [persisted] = await f.db
      .select({ phase: mcpOperationArtwork.phase })
      .from(mcpOperationArtwork)

    expect(persisted?.phase).toBe(result.phase)
    expect(f.logs).toEqual([])
  },
)

test.each(['target_read', 'transition'] as const)(
  'a real D1 %s failure emits bounded diagnostics and retains pending',
  async (step) => {
    await using f = await setup(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'image/jpeg' },
        }),
    )

    if (step === 'target_read') {
      await f.db.run(sql`CREATE TRIGGER corrupt_artwork_target AFTER UPDATE ON mcp_operation_artwork
        WHEN NEW.lease_generation > OLD.lease_generation
        BEGIN UPDATE music_albums SET coverImageUrl = X'01'; END`)
    } else {
      await f.db
        .run(sql`CREATE TRIGGER reject_artwork_transition BEFORE UPDATE ON mcp_operation_artwork
        WHEN NEW.phase = 'uploading'
        BEGIN SELECT RAISE(ABORT, 'synthetic-private-artwork-diagnostic'); END`)
    }

    const result = await Effect.runPromise(withTestLayer(f.run, Layer.mergeAll(f.layer, f.logging)))
    expect(result).toEqual({ phase: 'pending', associatedRevision: null, failureCode: null })
    expect(f.logs).toHaveLength(1)
    expect(f.logs[0]?.annotations).toEqual({ step, dependency: 'database', reason: step })
    expect(JSON.stringify(f.logs)).not.toContain(secret)
  },
)

test('provider timeout emits a bounded diagnostic and preserves pending', async () => {
  const started = await Effect.runPromise(Deferred.make<void>())

  await using f = await setup(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error(secret)), { once: true })
        Effect.runSync(Deferred.succeed(started, undefined))
      }),
  )

  const result = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        yield* TestClock.setTime(f.now)
        const task = yield* f.run.pipe(Effect.forkScoped)
        yield* Deferred.await(started)
        yield* TestClock.adjust('12 seconds')

        return yield* Fiber.join(task)
      }).pipe(Effect.scoped),
      Layer.mergeAll(f.layer, f.logging, TestClock.layer()),
    ),
  )

  expect(result.phase).toBe('pending')
  expect(f.logs).toHaveLength(1)
  expect(f.logs[0]?.annotations).toEqual({
    step: 'source_fetch',
    dependency: 'provider',
    reason: 'timeout',
  })
  expect(JSON.stringify(f.logs)).not.toContain(secret)
})
