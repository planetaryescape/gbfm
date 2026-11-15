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
import { ObjectStoreClient } from '@/services/storage/object-store-client'
import { R2ObjectStoreClientLayer } from '@/services/storage/r2-object-store-client'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { McpActor } from '../authorization'
import { CommandAuthority } from '../command-authority'
import type { UpdateDraftInput } from '../contracts'
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

let failCopies = false

let copies: Array<string> = []

const store = R2ObjectStoreClientLayer({ userContent: bucket, mixes: bucket }, async (request) => {
  if (failCopies) throw new Error('Disposable copy outage')
  const source = request.headers?.['x-amz-copy-source']

  if (!source) throw new Error('Unexpected storage request')
  const original = await bucket.get(source.split('/').slice(2).join('/'))

  if (!original) throw new Error('Missing private original')
  await bucket.put(request.key, await original.arrayBuffer(), {
    httpMetadata: original.httpMetadata ?? {},
    customMetadata: original.customMetadata ?? {},
  })
  copies.push(request.key)

  return new Response('<CopyObjectResult><ETag>fixture</ETag></CopyObjectResult>')
}).pipe(Layer.provide(configuration))

const makeLayer = (storage = store) =>
  DraftArtworkServiceLayer.pipe(
    Layer.provide(storage),
    Layer.provide(configuration),
    Layer.provide(Layer.succeed(EditorialMcpConfig, endpoint)),
    Layer.provide(DatabaseTestLayer),
  )

const layer = makeLayer()

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
    readonly storage?: Layer.Layer<ObjectStoreClient>
  } = {},
) => {
  const actorId = options.actorId ?? ownerId

  const principal = Schema.decodeUnknownSync(McpPrincipal)({
    userId: actorId,
    clientId: 'fixture-client',
    scopes: options.scopes ?? ['posts:read', 'drafts:write'],
  })

  const provided = withTestLayer(effect, options.storage ? makeLayer(options.storage) : layer).pipe(
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
  failCopies = false
  copies = []
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

    for (const fileName of ['.', '..']) {
      await expect(prepare({ ...request, fileName })).rejects.toMatchObject({
        code: 'invalid_input',
      })
    }

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

  test.each([
    ['UTF8 byte limit', 'é'.repeat(51_190)],
    ['block limit', Array.from({ length: 2_000 }, () => 'Paragraph.').join('\n\n')],
  ])(
    'rejects merged banner content beyond the %s before every coupled mutation',
    async (_label, content) => {
      await db.update(postsTable).set({ content }).where(eq(postsTable.id, postId))
      const prepared = await prepare(await input())
      await put(prepared)

      const before = await Promise.all([
        db.select().from(postsTable),
        db.select().from(uploadAssetsTable),
        db.select().from(editorialOperations),
      ])

      await expect(
        attach({
          requestId: crypto.randomUUID(),
          postId,
          expectedVersion: await version(),
          coverUploadRequestId: prepared.upload.requestId,
          banner: { uploadRequestId: prepared.upload.requestId, alt: 'Synthetic limit fixture' },
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(
        await Promise.all([
          db.select().from(postsTable),
          db.select().from(uploadAssetsTable),
          db.select().from(editorialOperations),
        ]),
      ).toEqual(before)
    },
  )
})

const postScopes = ['posts:read', 'creator:write']

const preparePost = (
  request: typeof PrepareDraftImageInput.Type,
  options: Parameters<typeof run>[1] = {},
) =>
  run(
    Effect.flatMap(DraftArtworkService, (service) => service.preparePostImage(request)),
    { scopes: postScopes, ...options },
  )

const attachPost = (
  request: typeof AttachDraftArtworkInput.Type,
  options: Parameters<typeof run>[1] = {},
) =>
  run(
    Effect.flatMap(DraftArtworkService, (service) => service.attachPostArtwork(request)),
    { scopes: postScopes, ...options },
  )

const updatePost = (
  request: typeof UpdateDraftInput.Type,
  options: Parameters<typeof run>[1] = {},
) =>
  run(
    Effect.flatMap(DraftArtworkService, (service) => service.updatePost(request)),
    { scopes: postScopes, ...options },
  )

describe('authored editorial edits including published posts', () => {
  test.each(['title', 'cover', 'banner'])(
    'preserves canonical 101k source when editing published %s',
    async (field) => {
      const content = 'x'.repeat(101_000)
      await db.update(postsTable).set({ draft: false, content }).where(eq(postsTable.id, postId))
      const prepared = await preparePost(await input())
      await put(prepared)
      const expectedVersion = await version()
      const edit = { requestId: crypto.randomUUID(), postId, expectedVersion }

      const artwork =
        field === 'cover'
          ? { coverUploadRequestId: prepared.upload.requestId }
          : { banner: { uploadRequestId: prepared.upload.requestId, alt: 'Canonical banner' } }

      const saved =
        field === 'title'
          ? await updatePost({ ...edit, title: 'Canonical existing source' })
          : await attachPost({ ...edit, ...artwork })

      expect(saved.post.content).toContain(content)
      expect(saved.post.content === content).toBe(field !== 'banner')
      expect(saved.post.draft).toBe(false)
      expect(saved.post.creatorIds).toEqual([ownerId])
      expect(saved.post.version).not.toBe(expectedVersion)
      await expect(
        updatePost({
          requestId: crypto.randomUUID(),
          postId,
          expectedVersion: saved.post.version,
          content,
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(await version()).toBe(saved.post.version)
    },
  )

  test('rewrites an owned private inline image before the published prose commit and copies it afterwards', async () => {
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, postId))
    const prepared = await preparePost(await input())
    await put(prepared)
    const publicUrl = prepared.upload.publicUrl.replace('/private/', '/public/')
    const publicKey = prepared.upload.key.replace(/^private\//, 'public/')
    const atCopy: Array<{ draft: boolean; content: string | null }> = []

    const observeCommittedCopy = Layer.effect(
      ObjectStoreClient,
      Effect.gen(function* () {
        const actual = yield* ObjectStoreClient

        return {
          ...actual,
          copyObject: async (bucketName: string, source: string, destination: string) => {
            const [committed] = await db
              .select({ draft: postsTable.draft, content: postsTable.content })
              .from(postsTable)
              .where(eq(postsTable.id, postId))

            if (!committed) throw new Error('Expected committed inline-image post')
            atCopy.push(committed)

            return actual.copyObject(bucketName, source, destination)
          },
        }
      }),
    ).pipe(Layer.provide(store))

    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      content: `Intro.\n\n![Owned inline image](${prepared.upload.publicUrl})\n\nPreserved tail.`,
    }

    await expect(
      updatePost(request, { actorId: otherId, storage: observeCommittedCopy }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(copies).toHaveLength(0)
    expect(await version()).toBe(request.expectedVersion)
    const saved = await updatePost(request, { storage: observeCommittedCopy })
    expect(saved.post.draft).toBe(false)
    expect(saved.post.creatorIds).toEqual([ownerId])
    expect(saved.post.content).toContain(publicUrl)
    expect(saved.post.content).toContain('Preserved tail.')
    expect(saved.post.content).not.toContain('/private/')
    expect(atCopy).toEqual([{ draft: false, content: saved.post.content }])
    const delivered = await bucket.get(publicKey)

    if (!delivered) throw new Error('Expected public inline-image copy')
    expect(new Uint8Array(await delivered.arrayBuffer())).toEqual(new Uint8Array(bytes))
    expect(await bucket.head(prepared.upload.key)).not.toBeNull()
    expect(await updatePost(request)).toEqual(saved)
    expect(copies).toHaveLength(1)
    expect(await version()).toBe(saved.post.version)
  })

  test('rejects publication fields and noncanonical prose before changing any rows', async () => {
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, postId))

    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      title: 'Forbidden transition',
      draft: true,
    }

    const before = await Promise.all([
      db.select().from(postsTable),
      db.select().from(editorialOperations),
    ])

    await expect(updatePost(request)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      updatePost({
        requestId: crypto.randomUUID(),
        postId,
        expectedVersion: request.expectedVersion,
        content: 'é'.repeat(60_000),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(
      await Promise.all([db.select().from(postsTable), db.select().from(editorialOperations)]),
    ).toEqual(before)
  })
  test('edits published prose, preserves state and replays exact results after later edits', async () => {
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, postId))

    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      title: 'Edited published title',
      content: 'Edited published prose.',
      description: 'New description',
    }

    const [saved, concurrent] = await Promise.all([updatePost(request), updatePost(request)])
    expect(concurrent).toEqual(saved)
    expect(saved.post).toMatchObject({
      draft: false,
      postId,
      content: request.content,
      title: request.title,
      description: request.description,
    })

    const later = await updatePost({
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: saved.post.version,
      description: null,
    })

    expect(later.post.description).toBeNull()
    expect(later.post.content).toBe(request.content)
    expect(await updatePost(request)).toEqual(saved)
    await expect(updatePost({ ...request, content: 'Changed retry.' })).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(updatePost({ ...request, requestId: crypto.randomUUID() })).rejects.toMatchObject({
      code: 'conflict',
    })
    expect((await db.select().from(postsTable).where(eq(postsTable.id, postId)))[0]?.draft).toBe(
      false,
    )
  })

  test('copies attached artwork to canonical public delivery and retains private originals', async () => {
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, postId))
    const cover = await preparePost(await input())
    const banner = await preparePost(await input())
    await put(cover)
    await put(banner)
    expect(copies).toHaveLength(0)

    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      coverUploadRequestId: cover.upload.requestId,
      banner: { uploadRequestId: banner.upload.requestId, alt: 'Published banner' },
    }

    const saved = await attachPost(request)
    const publicKey = cover.upload.key.replace(/^private\//, 'public/')
    expect(saved.post.thumbnailUrl).toBe(cover.upload.publicUrl.replace('/private/', '/public/'))
    expect(saved.post.content).toContain(banner.upload.publicUrl.replace('/private/', '/public/'))
    expect(saved.post.content).not.toContain('/private/')
    expect(saved.post.draft).toBe(false)
    expect(copies).toHaveLength(2)
    const delivered = await bucket.get(publicKey)

    if (!delivered) throw new Error('Expected delivered public artwork')
    expect(new Uint8Array(await delivered.arrayBuffer())).toEqual(new Uint8Array(bytes))
    expect(delivered.httpMetadata?.contentType).toBe('image/png')
    expect(await bucket.head(cover.upload.key)).not.toBeNull()
    expect(
      (await db.select().from(uploadAssetsTable)).map((asset) => [asset.key, asset.status]),
    ).toEqual([
      [cover.upload.key, 'attached'],
      [banner.upload.key, 'attached'],
    ])
    expect(await attachPost(request)).toEqual(saved)
    expect(copies).toHaveLength(2)
  })

  test('repairs a committed public copy on exact retry without repeating the edit', async () => {
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, postId))
    const prepared = await preparePost(await input())
    await put(prepared)

    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      coverUploadRequestId: prepared.upload.requestId,
    }

    failCopies = true
    await expect(attachPost(request)).rejects.toMatchObject({ code: 'unavailable' })
    const committedVersion = await version()
    const operationCount = (await db.select().from(editorialOperations)).length
    expect(committedVersion).not.toBe(request.expectedVersion)
    expect(await bucket.head(prepared.upload.key.replace(/^private\//, 'public/'))).toBeNull()
    failCopies = false
    const saved = await attachPost(request)
    expect(saved.post.version).toBe(committedVersion)
    expect((await db.select().from(editorialOperations)).length).toBe(operationCount)
    expect(await bucket.head(prepared.upload.key.replace(/^private\//, 'public/'))).not.toBeNull()
  })

  test('does not create public copies after a committed post is unpublished', async () => {
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, postId))
    const prepared = await preparePost(await input())
    await put(prepared)

    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      coverUploadRequestId: prepared.upload.requestId,
    }

    failCopies = true
    await expect(attachPost(request)).rejects.toMatchObject({ code: 'unavailable' })
    await db.update(postsTable).set({ draft: true }).where(eq(postsTable.id, postId))
    failCopies = false
    await attachPost(request)
    expect(copies).toHaveLength(0)
    expect((await db.select().from(postsTable).where(eq(postsTable.id, postId)))[0]?.draft).toBe(
      true,
    )
  })

  test('keeps draft media private and excludes micros from general editing', async () => {
    const prepared = await preparePost(await input())
    await put(prepared)

    const saved = await attachPost({
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      coverUploadRequestId: prepared.upload.requestId,
    })

    expect(saved.post.thumbnailUrl).toBe(prepared.upload.publicUrl)
    expect(saved.post.draft).toBe(true)
    expect(copies).toHaveLength(0)

    const updated = await updatePost({
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: saved.post.version,
      title: 'Still private',
    })

    expect(updated.post.draft).toBe(true)
    await db.update(postsTable).set({ type: 'micro' }).where(eq(postsTable.id, postId))
    await expect(preparePost(await input())).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      updatePost({
        requestId: crypto.randomUUID(),
        postId,
        expectedVersion: await version(),
        content: 'No micro edit',
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  test('draft-write consent alone cannot authorize general edit tools', async () => {
    const request = await input()
    await expect(
      preparePost(request, { scopes: ['posts:read', 'drafts:write'] }),
    ).rejects.toMatchObject({ code: 'access_denied' })
    await expect(
      updatePost(
        {
          requestId: crypto.randomUUID(),
          postId,
          expectedVersion: request.expectedVersion,
          title: 'Denied',
        },
        { scopes: ['posts:read', 'drafts:write'] },
      ),
    ).rejects.toMatchObject({ code: 'access_denied' })
    expect(await db.select().from(editorialOperations)).toHaveLength(0)
  })

  test('revoked authorship and bans prevent mutation and original-result replay', async () => {
    const request = {
      requestId: crypto.randomUUID(),
      postId,
      expectedVersion: await version(),
      title: 'Owned edit',
    }

    const saved = await updatePost(request)
    await expect(
      updatePost(
        { ...request, requestId: crypto.randomUUID(), expectedVersion: saved.post.version },
        { actorId: otherId },
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
    await db.update(postCreators).set({ creatorId: otherId }).where(eq(postCreators.postId, postId))
    await expect(updatePost(request)).rejects.toMatchObject({ code: 'not_found' })
    await db.update(user).set({ banned: true }).where(eq(user.id, otherId))
    await expect(
      updatePost(
        { ...request, requestId: crypto.randomUUID(), expectedVersion: await version() },
        { actorId: otherId },
      ),
    ).rejects.toMatchObject({ code: 'access_denied' })
  })

  test('rechecks authorship immediately before public copy side effects', async () => {
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, postId))
    const prepared = await preparePost(await input())
    await put(prepared)

    const revokeAtPublicHead = Layer.effect(
      ObjectStoreClient,
      Effect.gen(function* () {
        const actual = yield* ObjectStoreClient

        return {
          ...actual,
          headObject: async (bucketName: string, key: string) => {
            if (key.startsWith('public/')) {
              await db
                .update(postCreators)
                .set({ creatorId: otherId })
                .where(eq(postCreators.postId, postId))
            }

            return actual.headObject(bucketName, key)
          },
        }
      }),
    ).pipe(Layer.provide(store))

    await expect(
      attachPost(
        {
          requestId: crypto.randomUUID(),
          postId,
          expectedVersion: await version(),
          coverUploadRequestId: prepared.upload.requestId,
        },
        { storage: revokeAtPublicHead },
      ),
    ).rejects.toMatchObject({ code: 'unavailable' })
    expect(copies).toHaveLength(0)
  })

  test('refuses another post receipt even when the target is published', async () => {
    const prepared = await preparePost(await input(otherPostId))
    await put(prepared)
    await db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, postId))
    await expect(
      attachPost({
        requestId: crypto.randomUUID(),
        postId,
        expectedVersion: await version(),
        coverUploadRequestId: prepared.upload.requestId,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(copies).toHaveLength(0)
  })
})
