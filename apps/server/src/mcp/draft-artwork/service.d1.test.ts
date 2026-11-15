import { createHash } from 'node:crypto'

import { McpPrincipal, PostId } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { Miniflare } from 'miniflare'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { editorialOperations } from '@/db/editorial-operation.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { uploadAssetsTable } from '@/db/upload-asset.schema'
import { createConfig, ConfigService } from '@/services/config.service'
import { R2ObjectStoreClientLayer } from '@/services/storage/r2-object-store-client'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { McpActor } from '../authorization'
import { CommandAuthority } from '../command-authority'
import { EditorialMcpConfig } from '../editorial'
import { loadEditorialSnapshot } from '../editorial-music/snapshot'
import { EditorialMcpSettings, projectPost } from '../model'
import { makeMcpWireResponse, McpWireResponse } from '../wire-response'
import type {
  AttachDraftArtworkInput,
  PrepareDraftImageInput,
  PreparedDraftImage,
} from './contracts'
import { DraftArtworkService, DraftArtworkServiceLayer } from './service'

const ownerId = Schema.decodeUnknownSync(UserId)('artwork-owner')

const otherId = Schema.decodeUnknownSync(UserId)('artwork-other')

const postId = Schema.decodeUnknownSync(PostId)('artwork-draft')

const otherPostId = Schema.decodeUnknownSync(PostId)('artwork-other-draft')

const endpoint = Schema.decodeUnknownSync(EditorialMcpSettings)({
  readScope: 'posts:read',
  environment: 'test',
  resourceUrl: 'https://api.example.test/mcp',
  frontendUrl: 'https://example.test',
})

const config = {
  ...createConfig(),
  storage: {
    provider: 'r2' as const,
    region: 'auto',
    accountId: 'test-account',
    accessKeyId: Redacted.make('fixture-access-key'),
    secretAccessKey: Redacted.make('fixture-secret-key'),
  },
}

const runtime = new Miniflare({
  script: 'export default { fetch() { return new Response() } }',
  modules: true,
  r2Buckets: ['ARTWORK'],
})

const bucket = await runtime.getR2Bucket('ARTWORK')

afterAll(() => runtime.dispose())

const configuration = Layer.succeed(ConfigService, config)

const store = R2ObjectStoreClientLayer({ userContent: bucket, mixes: bucket }).pipe(
  Layer.provide(configuration),
)

const layer = DraftArtworkServiceLayer.pipe(
  Layer.provide(store),
  Layer.provide(configuration),
  Layer.provide(Layer.succeed(EditorialMcpConfig, endpoint)),
  Layer.provide(DatabaseTestLayer),
)

const bytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
)

const contentMd5 = createHash('md5').update(bytes).digest('base64')

const run = <A, E>(
  effect: Effect.Effect<A, E, DraftArtworkService>,
  options: {
    readonly actorId?: typeof ownerId
    readonly scopes?: ReadonlyArray<string>
    readonly live?: boolean
    readonly authenticated?: boolean
  } = {},
) => {
  const actorId = options.actorId ?? ownerId

  const principal = Schema.decodeUnknownSync(McpPrincipal)({
    userId: actorId,
    clientId: 'fixture-client',
    scopes: options.scopes ?? ['posts:read', 'drafts:write'],
  })

  const provided = withTestLayer(effect, layer).pipe(
    Effect.provideService(
      CommandAuthority,
      CommandAuthority.of({
        checkpoint: () =>
          Effect.succeed({
            actorId,
            clientId: principal.clientId,
            resource: endpoint.resourceUrl,
            liveGuard: options.live === false ? sql`0` : sql`1`,
          }),
      }),
    ),
    Effect.provideService(McpWireResponse, makeMcpWireResponse(1, 'json')),
  )

  if (options.authenticated === false) return Effect.runPromise(provided)

  return Effect.runPromise(provided.pipe(Effect.provideService(McpActor, principal)))
}

const version = (id = postId) =>
  Effect.runPromise(
    withTestLayer(
      loadEditorialSnapshot(db, id).pipe(Effect.flatMap((post) => projectPost(post, endpoint))),
      DatabaseTestLayer,
    ),
  ).then((post) => post.version)

const prepare = (input: typeof PrepareDraftImageInput.Type, options?: Parameters<typeof run>[1]) =>
  run(
    Effect.flatMap(DraftArtworkService, (service) => service.prepare(input)),
    options,
  )

const attach = (input: typeof AttachDraftArtworkInput.Type, options?: Parameters<typeof run>[1]) =>
  run(
    Effect.flatMap(DraftArtworkService, (service) => service.attach(input)),
    options,
  )

const input = async (id = postId): Promise<typeof PrepareDraftImageInput.Type> => ({
  requestId: crypto.randomUUID(),
  postId: id,
  expectedVersion: await version(id),
  fileName: 'fixture.png',
  contentType: 'image/png',
  fileSize: bytes.length,
  contentMd5,
})

const put = (prepared: typeof PreparedDraftImage.Type) =>
  bucket.put(prepared.upload.key, bytes, {
    httpMetadata: { contentType: 'image/png' },
    customMetadata: { 'artwork-receipt': prepared.upload.assetId },
    onlyIf: { etagDoesNotMatch: '*' },
    md5: Buffer.from(contentMd5, 'base64'),
  })

beforeEach(async () => {
  await db.delete(editorialOperations)
  await db.delete(uploadAssetsTable)
  await db.delete(postCreators)
  await db.delete(postsTable)
  await db.delete(user)
  await db.insert(user).values(
    [ownerId, otherId].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      role: 'creator',
      banned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  )
  await db.insert(postsTable).values(
    [postId, otherPostId].map((id) => ({
      id,
      slug: id,
      title: 'Disposable editorial',
      type: 'post' as const,
      draft: true,
      content: '::layout{variant="spotlight"}\n\nOriginal prose.',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  )
  await db
    .insert(postCreators)
    .values([postId, otherPostId].map((id) => ({ postId: id, creatorId: ownerId })))
})

describe('native draft artwork with migrated D1 and R2', () => {
  test('prepares an exact replayable private upload without changing the draft version', async () => {
    const request = await input()
    const [prepared, concurrent] = await Promise.all([prepare(request), prepare(request)])
    expect(concurrent).toEqual(prepared)
    expect(await prepare(request)).toEqual(prepared)
    expect(await version()).toBe(request.expectedVersion)
    expect(prepared.upload.publicUrl).toContain('/user-content/private/artwork-owner/image/')
    expect(prepared.upload.headers).toEqual({
      'content-type': 'image/png',
      'content-md5': contentMd5,
      'content-length': String(bytes.length),
      'if-none-match': '*',
      'x-amz-meta-artwork-receipt': prepared.upload.assetId,
    })
    expect(new URL(prepared.upload.uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-md5;content-type;host;if-none-match;x-amz-meta-artwork-receipt',
    )
    await expect(prepare({ ...request, fileName: 'changed.png' })).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(await db.select().from(uploadAssetsTable)).toHaveLength(1)
  })

  test('atomically attaches a cover and leading banner, preserves layout, and replays original results', async () => {
    const cover = await prepare(await input())
    const banner = await prepare(await input())
    await put(cover)
    await put(banner)

    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      coverUploadRequestId: cover.upload.requestId,
      banner: { uploadRequestId: banner.upload.requestId, alt: 'Synthetic banner' },
    }

    const [saved, concurrent] = await Promise.all([attach(request), attach(request)])
    expect(concurrent).toEqual(saved)
    expect(saved.post.thumbnailUrl).toBe(cover.upload.publicUrl)
    expect(saved.post.content).toContain(
      `::layout{variant="spotlight"}\n\n![Synthetic banner](${banner.upload.publicUrl})`,
    )
    expect(saved.post.content).toContain('Original prose.')
    expect(saved.post.draft).toBe(true)
    expect(await attach(request)).toEqual(saved)
    const rows = await db.select().from(uploadAssetsTable)
    expect(rows.map((row) => [row.status, row.attachedToTable, row.attachedToId])).toEqual([
      ['attached', 'posts', postId],
      ['attached', 'posts', postId],
    ])

    const later = await attach({
      ...request,
      requestId: crypto.randomUUID(),
      expectedVersion: saved.post.version,
      banner: { ...request.banner, alt: 'Replacement banner' },
    })

    expect(later.post.content?.match(/!\[/g)).toHaveLength(1)
    expect(await attach(request)).toEqual(saved)
    await expect(
      attach({ ...request, banner: { ...request.banner, alt: 'Changed retry' } }),
    ).rejects.toMatchObject({ code: 'conflict' })
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, postId))
    await expect(attach(request)).rejects.toMatchObject({ code: 'not_found' })
  })

  test('refuses unauthenticated, unscoped, banned and non-author access without creating receipts', async () => {
    const request = await input()
    await expect(prepare(request, { authenticated: false })).rejects.toMatchObject({
      code: 'access_denied',
    })
    await expect(prepare(request, { scopes: ['posts:read'] })).rejects.toMatchObject({
      code: 'access_denied',
    })
    await expect(prepare(request, { actorId: otherId })).rejects.toMatchObject({
      code: 'not_found',
    })
    await db.update(user).set({ banned: true }).where(eq(user.id, ownerId))
    await expect(prepare(request)).rejects.toMatchObject({ code: 'access_denied' })
    expect(await db.select().from(editorialOperations)).toHaveLength(0)
  })

  test('never prepares, attaches or replays against a published post', async () => {
    const prepared = await prepare(await input())
    await put(prepared)

    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      coverUploadRequestId: prepared.upload.requestId,
    }

    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, postId))
    await expect(attach(request)).rejects.toMatchObject({ code: 'not_found' })
    await expect(prepare(await input())).rejects.toMatchObject({ code: 'not_found' })
    expect((await db.select().from(uploadAssetsTable))[0]?.status).toBe('pending')
  })

  test('rejects stale prepare and attachment versions', async () => {
    const request = await input()
    const prepared = await prepare(request)
    await put(prepared)
    await db.update(postsTable).set({ title: 'New user edit' }).where(eq(postsTable.id, postId))
    await expect(prepare({ ...request, requestId: crypto.randomUUID() })).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(
      attach({
        requestId: crypto.randomUUID(),
        postId,
        expectedVersion: request.expectedVersion,
        coverUploadRequestId: prepared.upload.requestId,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  test('requires completed matching bytes and signed receipt metadata', async () => {
    const prepared = await prepare(await input())

    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      coverUploadRequestId: prepared.upload.requestId,
    }

    await expect(attach(request)).rejects.toMatchObject({ code: 'invalid_input' })
    await bucket.put(prepared.upload.key, bytes)
    await expect(attach(request)).rejects.toMatchObject({ code: 'invalid_input' })
    await bucket.put(prepared.upload.key, new Uint8Array([1, 2, 3]), {
      customMetadata: { 'artwork-receipt': prepared.upload.assetId },
    })
    await expect(attach(request)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(await version()).toBe(request.expectedVersion)
  })

  test('refuses another draft receipt and another actor receipt', async () => {
    const prepared = await prepare(await input(otherPostId))
    await put(prepared)
    await expect(
      attach({
        requestId: crypto.randomUUID(),
        postId,
        expectedVersion: await version(),
        coverUploadRequestId: prepared.upload.requestId,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    await db
      .update(postCreators)
      .set({ creatorId: otherId })
      .where(eq(postCreators.postId, otherPostId))
    await expect(
      attach(
        {
          requestId: crypto.randomUUID(),
          postId: otherPostId,
          expectedVersion: await version(otherPostId),
          coverUploadRequestId: prepared.upload.requestId,
        },
        { actorId: otherId },
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  test('fences mismatched asset ownership and reassignment inside the attachment batch', async () => {
    const prepared = await prepare(await input())
    await put(prepared)

    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      coverUploadRequestId: prepared.upload.requestId,
    }

    await db
      .update(uploadAssetsTable)
      .set({ userId: otherId })
      .where(eq(uploadAssetsTable.id, prepared.upload.assetId))
    await expect(attach(request)).rejects.toMatchObject({ code: 'conflict' })
    await db
      .update(uploadAssetsTable)
      .set({
        userId: ownerId,
        status: 'attached',
        attachedToTable: 'posts',
        attachedToId: otherPostId,
      })
      .where(eq(uploadAssetsTable.id, prepared.upload.assetId))
    await expect(attach(request)).rejects.toMatchObject({ code: 'conflict' })
    await db
      .update(uploadAssetsTable)
      .set({ userId: otherId, status: 'attached', attachedToTable: 'posts', attachedToId: postId })
      .where(eq(uploadAssetsTable.id, prepared.upload.assetId))
    await expect(attach(request)).rejects.toMatchObject({ code: 'conflict' })
    expect(await version()).toBe(request.expectedVersion)
  })

  test('does not refresh expired upload URLs or attach expired assets', async () => {
    const request = await input()
    const prepared = await prepare(request)
    await put(prepared)
    await db.update(editorialOperations).set({
      result: JSON.stringify({
        ...prepared,
        upload: { ...prepared.upload, expiresAt: Date.now() - 1 },
      }),
    })
    await expect(prepare(request)).rejects.toMatchObject({ code: 'expired' })
    expect(await db.select().from(uploadAssetsTable)).toHaveLength(1)
    await db.update(uploadAssetsTable).set({ expiresAt: new Date(Date.now() - 1) })
    await expect(
      attach({
        requestId: crypto.randomUUID(),
        postId,
        expectedVersion: request.expectedVersion,
        coverUploadRequestId: request.requestId,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await version()).toBe(request.expectedVersion)
  })

  test('does not attach or prepare when live authority is revoked', async () => {
    const request = await input()
    await expect(prepare(request, { live: false })).rejects.toMatchObject({ code: 'conflict' })
    expect(await db.select().from(editorialOperations)).toHaveLength(0)
    const prepared = await prepare(request)
    await put(prepared)
    await expect(
      attach(
        {
          requestId: crypto.randomUUID(),
          postId,
          expectedVersion: await version(),
          coverUploadRequestId: request.requestId,
        },
        { live: false },
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await version()).toBe(request.expectedVersion)
  })

  test('retains expired receipt tombstones and refuses changed retries', async () => {
    const request = await input()
    const prepared = await prepare(request)
    await db
      .update(editorialOperations)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
    await expect(prepare(request)).rejects.toMatchObject({ code: 'expired' })
    await expect(prepare({ ...request, fileName: 'changed.png' })).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(
      attach({
        requestId: crypto.randomUUID(),
        postId,
        expectedVersion: await version(),
        coverUploadRequestId: prepared.upload.requestId,
      }),
    ).rejects.toMatchObject({ code: 'expired' })
  })

  test('validates bounded raster metadata before allocating an asset', async () => {
    const request = await input()
    await expect(prepare({ ...request, fileSize: 0 })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(prepare({ ...request, contentMd5: 'invalid' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    expect(await db.select().from(uploadAssetsTable)).toHaveLength(0)
  })

  test('R2 enforces create-only writes and checksum verification on the disposable object', async () => {
    const prepared = await prepare(await input())
    expect(await put(prepared)).not.toBeNull()
    expect(await put(prepared)).toBeNull()
    const another = await prepare(await input())
    await expect(
      bucket.put(another.upload.key, Buffer.from('different'), {
        md5: Buffer.from(contentMd5, 'base64'),
      }),
    ).rejects.toThrow()
  })
})
