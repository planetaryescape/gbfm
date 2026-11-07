import { Credential } from '@gbfm/api/middleware/actor'
import { KeyId } from '@gbfm/core/personal-access-keys'
import { eq } from 'drizzle-orm'
import { Effect, Exit, Layer, Result, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { audioCreators, audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import { DatabaseLayer, makeDatabaseClient } from '@/db/layer'
import { musicLabelsTable, musicLabelCreatorsTable } from '@/db/music-entity.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { showsTable } from '@/db/show.schema'
import { uploadAssetsTable } from '@/db/upload-asset.schema'
import { DatabaseError, S3Error, UnauthorizedError, ValidationError } from '@/errors'
import { CryptoLive } from '@/lib/crypto'
import { MdxServiceLayer } from '@/lib/mdx'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { AudioService, AudioServiceLayer } from './audio.service'
import { ConfigService, createConfig } from './config.service'
import { attachedMediaUrls, makeMediaPublication } from './media-publication'
import { PostService, PostServiceLayer } from './post.service'
import { ReleaseService, ReleaseServiceLayer } from './release.service'
import { ShowService, ShowServiceLayer } from './show.service'
import { ObjectStoreClient } from './storage/object-store-client'
import { UploadAssetServiceLayer } from './upload-asset.service'

const actor = { userId: 'owner', userRole: 'user', credential: undefined }

const collaborator = { userId: 'collaborator', userRole: 'user', credential: undefined }

const config = {
  ...createConfig(),
  urls: { ...createConfig().urls, bucketRouter: 'https://media.example.test' },
}

const imageKey = 'private/owner/image/image-id/cover.png'

const audioKey = 'private/owner/multipart/audio-id/123/audio_track.mp3'

const assetUrl = (key: string) => `${config.urls.bucketRouter}/user-content/${key}`

const publicKey = (key: string) => key.replace('private/', 'public/')

function memoryStorage() {
  const objects = new Map<string, string>([
    [imageKey, 'image bytes'],
    [audioKey, 'audio bytes'],
  ])

  const copies: Array<{ source: string; destination: string }> = []
  const heads: Array<string> = []
  let failCopies = false
  let copyGate: Promise<void> | undefined
  const copyStarted = Promise.withResolvers<void>()
  const copyFinished = Promise.withResolvers<void>()
  const unused = () => Promise.reject(new Error('Unexpected storage operation'))

  const store: ObjectStoreClient = {
    provider: 'r2',
    putObject: unused,
    presignPutObject: unused,
    deleteObject: unused,
    listObjects: unused,
    listBuckets: unused,
    createMultipartUpload: unused,
    presignUploadPart: unused,
    completeMultipartUpload: unused,
    abortMultipartUpload: unused,
    listMultipartParts: unused,
    headObject: async (_bucket, key) => {
      heads.push(key)
      const body = objects.get(key)

      return body === undefined ? null : { size: body.length, metadata: {} }
    },
    copyObject: async (_bucket, source, destination) => {
      if (failCopies) throw new Error('Disposable test storage outage')
      copyStarted.resolve()

      if (copyGate) await copyGate
      const body = objects.get(source)

      if (body === undefined) throw new Error('Missing source')
      objects.set(destination, body)
      copies.push({ source, destination })
      copyFinished.resolve()
    },
  }

  return {
    store,
    objects,
    copies,
    heads,
    fail: (value: boolean) => {
      failCopies = value
    },
    pauseCopies: () => {
      const gate = Promise.withResolvers<void>()
      copyGate = gate.promise

      return { started: copyStarted.promise, release: gate.resolve, finished: copyFinished.promise }
    },
  }
}

test('admin PAT cannot newly attach foreign private media but can retain an authorized attachment', async () => {
  const storage = memoryStorage()
  const prepare = makeMediaPublication(config, storage.store)

  const keyActor = {
    ...collaborator,
    userRole: 'admin',
    credential: Credential.PersonalAccessKey({
      keyId: Schema.decodeUnknownSync(KeyId)(crypto.randomUUID()),
      environment: 'dev',
      scopes: ['posts:update', 'posts:publish'],
    }),
  }

  const data = { thumbnailUrl: assetUrl(imageKey), draft: false }
  const denied = await Effect.runPromise(prepare(data, keyActor).pipe(Effect.result))
  expect(Result.isFailure(denied) && denied.failure).toBeInstanceOf(UnauthorizedError)
  expect(storage.copies).toEqual([])
  const retained = await Effect.runPromise(prepare(data, keyActor, data))
  await Effect.runPromise(retained.publish)
  expect(retained.data.thumbnailUrl).toBe(assetUrl(publicKey(imageKey)))
  expect(storage.copies).toEqual([{ source: imageKey, destination: publicKey(imageKey) }])
})

async function harness() {
  const resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db.insert(user).values(
    [actor, collaborator].map(({ userId }) => ({
      id: userId,
      name: userId,
      email: `${userId}@example.test`,
    })),
  )
  const storage = memoryStorage()

  const deps = Layer.mergeAll(
    Layer.succeed(ConfigService, config),
    Layer.succeed(ObjectStoreClient, storage.store),
    MdxServiceLayer,
    CryptoLive,
    UploadAssetServiceLayer,
  )

  const layer = Layer.mergeAll(
    ShowServiceLayer,
    AudioServiceLayer,
    PostServiceLayer,
    ReleaseServiceLayer,
  ).pipe(Layer.provide(deps), Layer.provide(DatabaseLayer(resource.database)))

  const services = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        return {
          show: yield* ShowService,
          audio: yield* AudioService,
          post: yield* PostService,
          release: yield* ReleaseService,
        }
      }),
      layer,
    ),
  )

  return { ...services, ...storage, db, [Symbol.asyncDispose]: () => resource.dispose() }
}

describe('media publication at the content/storage seam', () => {
  test('audio creator failure rolls back creator replacement but retains its earlier content write without copying', async () => {
    await using h = await harness()

    const audio = await Effect.runPromise(
      h.audio.create(
        {
          title: 'Draft',
          slug: 'partial-audio',
          type: 'mix',
          content: '',
          draft: true,
          url: assetUrl(audioKey),
          thumbnailUrl: assetUrl(imageKey),
        },
        [actor.userId],
        { actorId: actor.userId, idempotencyKey: 'partial-audio' },
      ),
    )

    const result = await Effect.runPromise(
      h.audio
        .update('mix', 'partial-audio', actor.userId, actor.userRole, {
          title: 'Saved before creator failure',
          draft: false,
          creatorIds: ['missing-creator'],
        })
        .pipe(Effect.result),
    )

    expect(Result.isFailure(result) && result.failure).toBeInstanceOf(DatabaseError)
    expect(await h.db.select().from(audioTable).where(eq(audioTable.id, audio.id))).toMatchObject([
      {
        title: 'Saved before creator failure',
        draft: false,
        url: assetUrl(publicKey(audioKey)),
      },
    ])
    expect(
      await h.db.select().from(audioCreators).where(eq(audioCreators.audioId, audio.id)),
    ).toMatchObject([{ creatorId: actor.userId }])
    expect(h.copies).toEqual([])
    expect(h.objects.has(audioKey)).toBe(true)
  })

  test('audio publication continues after an informational tracking failure and attaches later originals', async () => {
    await using h = await harness()
    await h.db.insert(uploadAssetsTable).values(
      [audioKey, imageKey].map((key) => ({
        userId: actor.userId,
        key,
        bucket: config.buckets.userContent,
        assetType: 'image' as const,
        status: 'uploaded' as const,
        expiresAt: new Date(),
      })),
    )
    await h.db.$client
      .prepare(`CREATE TRIGGER fail_audio_tracking BEFORE UPDATE ON upload_assets
      WHEN old.key = '${audioKey}' BEGIN SELECT RAISE(ABORT, 'fixture tracking failure'); END`)
      .run()

    const audio = await Effect.runPromise(
      h.audio.create(
        {
          title: 'Tracking failure',
          slug: 'tracking',
          type: 'mix',
          content: '',
          url: assetUrl(audioKey),
          thumbnailUrl: assetUrl(imageKey),
        },
        [actor.userId],
        { actorId: actor.userId, idempotencyKey: 'tracking' },
      ),
    )

    expect(audio.url).toBe(assetUrl(publicKey(audioKey)))
    expect(h.copies).toHaveLength(2)
    expect(
      await h.db.select().from(uploadAssetsTable).where(eq(uploadAssetsTable.key, audioKey)),
    ).toMatchObject([{ status: 'uploaded', attachedToId: null }])
    expect(
      await h.db.select().from(uploadAssetsTable).where(eq(uploadAssetsTable.key, imageKey)),
    ).toMatchObject([{ status: 'attached', attachedToId: audio.id, attachedToTable: 'audio' }])
  })

  test.each([
    ['missing creator', ['missing-creator']],
    ['mixed valid and invalid creators', [collaborator.userId, 'missing-creator']],
    ['duplicate creators', [collaborator.userId, collaborator.userId]],
  ])(
    'post replacement with %s preserves existing creators and earlier content without copying',
    async (_name, creatorIds) => {
      await using h = await harness()

      const post = await Effect.runPromise(
        h.post.create(
          {
            title: 'Draft',
            slug: 'partial',
            type: 'post',
            content: 'Draft content',
            draft: true,
            thumbnailUrl: assetUrl(imageKey),
          },
          [actor.userId],
          actor,
        ),
      )

      expect(
        await h.db.select().from(postCreators).where(eq(postCreators.postId, post.id)),
      ).toMatchObject([{ creatorId: actor.userId }])

      const result = await Effect.runPromise(
        h.post
          .update('partial', actor.userId, actor.userRole, {
            title: 'Saved before creator failure',
            draft: false,
            creatorIds,
          })
          .pipe(Effect.result),
      )

      expect(Result.isFailure(result) && result.failure).toBeInstanceOf(DatabaseError)
      expect(await h.db.select().from(postsTable).where(eq(postsTable.id, post.id))).toMatchObject([
        {
          title: 'Saved before creator failure',
          draft: false,
          thumbnailUrl: assetUrl(publicKey(imageKey)),
        },
      ])
      expect(
        await h.db.select().from(postCreators).where(eq(postCreators.postId, post.id)),
      ).toMatchObject([{ creatorId: actor.userId }])
      expect(h.copies).toEqual([])
      expect(h.objects.has(imageKey)).toBe(true)
    },
  )

  test.each([
    ['replacement', { creatorIds: [collaborator.userId] }, collaborator.userId],
    ['omitted creators', {}, actor.userId],
    ['empty creators', { creatorIds: [] }, actor.userId],
  ])('post creator-only update preserves %s behavior', async (_name, data, expectedCreatorId) => {
    await using h = await harness()

    const post = await Effect.runPromise(
      h.post.create(
        {
          title: 'Draft',
          slug: 'creators-only',
          type: 'post',
          content: 'Draft content',
          draft: true,
        },
        [actor.userId],
        actor,
      ),
    )

    const originalRows = await h.db.select().from(postsTable).where(eq(postsTable.id, post.id))

    const updated = await Effect.runPromise(
      h.post.update(post.slug, actor.userId, actor.userRole, data),
    )

    expect(updated.creators?.map((creator) => creator.id)).toEqual([expectedCreatorId])
    expect(
      await h.db.select().from(postCreators).where(eq(postCreators.postId, post.id)),
    ).toMatchObject([{ creatorId: expectedCreatorId }])
    expect(await h.db.select().from(postsTable).where(eq(postsTable.id, post.id))).toEqual(
      originalRows,
    )
    expect(h.copies).toEqual([])
  })

  test('unauthorized post creator replacement changes neither creators nor content', async () => {
    await using h = await harness()

    const post = await Effect.runPromise(
      h.post.create(
        {
          title: 'Draft',
          slug: 'unauthorized-creators',
          type: 'post',
          content: 'Draft content',
          draft: true,
        },
        [actor.userId],
        actor,
      ),
    )

    const originalRows = await h.db.select().from(postsTable).where(eq(postsTable.id, post.id))

    const result = await Effect.runPromise(
      h.post
        .update(post.slug, collaborator.userId, collaborator.userRole, {
          title: 'Unauthorized edit',
          creatorIds: [collaborator.userId],
        })
        .pipe(Effect.result),
    )

    expect(Result.isFailure(result) && result.failure).toBeInstanceOf(UnauthorizedError)
    expect(
      await h.db.select().from(postCreators).where(eq(postCreators.postId, post.id)),
    ).toMatchObject([{ creatorId: actor.userId }])
    expect(await h.db.select().from(postsTable).where(eq(postsTable.id, post.id))).toEqual(
      originalRows,
    )
    expect(h.copies).toEqual([])
  })

  test('post publication copy failure retains committed content and republishing repairs without replacing originals', async () => {
    await using h = await harness()

    const post = await Effect.runPromise(
      h.post.create(
        {
          title: 'Draft',
          slug: 'repair',
          type: 'post',
          content: 'Draft content',
          draft: true,
          thumbnailUrl: assetUrl(imageKey),
        },
        [actor.userId],
        actor,
      ),
    )

    h.fail(true)

    const failed = await Effect.runPromise(
      h.post.update('repair', actor.userId, actor.userRole, { draft: false }).pipe(Effect.result),
    )

    expect(Result.isFailure(failed) && failed.failure).toBeInstanceOf(S3Error)
    expect(await h.db.select().from(postsTable).where(eq(postsTable.id, post.id))).toMatchObject([
      {
        draft: false,
        thumbnailUrl: assetUrl(publicKey(imageKey)),
      },
    ])
    expect(h.copies).toEqual([])
    h.fail(false)

    const repaired = await Effect.runPromise(
      h.post.update('repair', actor.userId, actor.userRole, { draft: false }),
    )

    expect(repaired.thumbnailUrl).toBe(assetUrl(publicKey(imageKey)))
    await Effect.runPromise(h.post.update('repair', actor.userId, actor.userRole, { draft: true }))
    await Effect.runPromise(h.post.update('repair', actor.userId, actor.userRole, { draft: false }))
    expect(h.copies).toHaveLength(1)
    expect(h.objects.get(imageKey)).toBe('image bytes')
    expect(h.objects.get(publicKey(imageKey))).toBe('image bytes')
  })

  test('interruption during copy leaves saved public references and does not cancel the in-flight storage promise', async () => {
    await using h = await harness()
    const pause = h.pauseCopies()
    const controller = new AbortController()

    const pending = Effect.runPromiseExit(
      h.post.create(
        {
          title: 'Interrupted',
          slug: 'interrupted',
          type: 'post',
          content: 'Published content',
          thumbnailUrl: assetUrl(imageKey),
        },
        [actor.userId],
        actor,
      ),
      { signal: controller.signal },
    )

    await pause.started
    controller.abort()
    const exit = await pending
    const saved = await h.db.select().from(postsTable).where(eq(postsTable.slug, 'interrupted'))
    const copiesBeforeRelease = [...h.copies]
    pause.release()
    await pause.finished
    expect(Exit.hasInterrupts(exit)).toBe(true)
    expect(saved).toMatchObject([{ draft: false, thumbnailUrl: assetUrl(publicKey(imageKey)) }])
    expect(copiesBeforeRelease).toEqual([])
    expect(h.objects.get(publicKey(imageKey))).toBe('image bytes')
    expect(h.objects.get(imageKey)).toBe('image bytes')
  })

  test('release drafts preserve originals and publish media only after a successful save', async () => {
    await using h = await harness()
    await h.db
      .insert(musicLabelsTable)
      .values({ id: 'label', name: 'Fixture label', slug: 'label' })
    await h.db.insert(musicLabelCreatorsTable).values({ labelId: 'label', creatorId: actor.userId })

    const release = await Effect.runPromise(
      h.release.create(
        {
          title: 'Release',
          slug: 'release',
          labelId: 'label',
          releaseDate: new Date('2026-01-01'),
          content: `![cover](${assetUrl(imageKey)})`,
          thumbnailUrl: assetUrl(imageKey),
          bannerImageUrl: assetUrl(imageKey),
          draft: true,
        },
        actor.userId,
        actor.userRole,
      ),
    )

    expect(release.thumbnailUrl).toBe(assetUrl(imageKey))
    expect(h.copies).toEqual([])

    const published = await Effect.runPromise(
      h.release.update('release', actor.userId, actor.userRole, { draft: false }),
    )

    expect(published.thumbnailUrl).toBe(assetUrl(publicKey(imageKey)))
    expect(published.bannerImageUrl).toBe(assetUrl(publicKey(imageKey)))
    expect(attachedMediaUrls(published)).toEqual([
      assetUrl(publicKey(imageKey)),
      assetUrl(publicKey(imageKey)),
      assetUrl(publicKey(imageKey)),
    ])
    expect(h.copies).toHaveLength(1)
  })

  test('image extraction does not treat prose, code, links or unsupported HTML as attachments', async () => {
    const h = memoryStorage()
    const content = `${assetUrl(imageKey)}\n\n[link](${assetUrl(imageKey)})\n\n\`![code](${assetUrl(imageKey)})\`\n\n<img src="${assetUrl(imageKey)}">`
    expect(attachedMediaUrls({ content })).toEqual([])

    const prepared = await Effect.runPromise(
      makeMediaPublication(config, h.store)({ content }, collaborator),
    )

    await Effect.runPromise(prepared.publish)
    expect(prepared.data.content).toBe(content)
    expect(h.copies).toEqual([])
    expect(h.heads).toEqual([])
  })

  test('drafts do not copy; publication rewrites artwork and parsed inline images only; unpublishing does not revoke copies', async () => {
    await using h = await harness()
    const source = `Prose ${assetUrl(imageKey)}\n\n![cover](${assetUrl(imageKey)})\n\n\`${assetUrl(imageKey)}\``

    const draft = await Effect.runPromise(
      h.show.create(
        {
          title: 'Show',
          slug: 'show',
          content: source,
          draft: true,
          thumbnailUrl: assetUrl(imageKey),
        },
        [actor.userId],
        actor,
      ),
    )

    expect(draft.thumbnailUrl).toBe(assetUrl(imageKey))
    expect(h.copies).toEqual([])

    const published = await Effect.runPromise(
      h.show.update('show', actor.userId, actor.userRole, { draft: false }),
    )

    expect(published.thumbnailUrl).toBe(assetUrl(publicKey(imageKey)))
    expect(published.content).toBe(
      `Prose ${assetUrl(imageKey)}\n\n![cover](<${assetUrl(publicKey(imageKey))}>)\n\n\`${assetUrl(imageKey)}\``,
    )
    expect(h.objects.get(publicKey(imageKey))).toBe('image bytes')
    expect(h.objects.get(imageKey)).toBe('image bytes')

    const unpublished = await Effect.runPromise(
      h.show.update('show', actor.userId, actor.userRole, { draft: true }),
    )

    expect(unpublished.thumbnailUrl).toBe(published.thumbnailUrl)
    // Publication is permanent even when the original page returns to draft.
    expect(h.objects.has(publicKey(imageKey))).toBe(true)
    expect(h.copies).toHaveLength(1)
    await Effect.runPromise(
      h.show.create(
        {
          title: 'Shared draft',
          slug: 'shared',
          content: '',
          draft: true,
          thumbnailUrl: published.thumbnailUrl,
        },
        [collaborator.userId],
        collaborator,
      ),
    )
    expect(h.copies).toHaveLength(1)
  })

  test('failed atomic D1 saves cannot expose a copy', async () => {
    await using h = await harness()

    const result = await Effect.runPromise(
      h.show
        .create(
          {
            title: 'Invalid creator',
            slug: 'invalid',
            content: '',
            thumbnailUrl: assetUrl(imageKey),
          },
          ['nonexistent-user'],
          actor,
        )
        .pipe(Effect.result),
    )

    expect(Result.isFailure(result) && result.failure).toBeInstanceOf(DatabaseError)
    expect(await h.db.select().from(showsTable).where(eq(showsTable.slug, 'invalid'))).toEqual([])
    expect(h.copies).toEqual([])
    expect(h.objects.has(publicKey(imageKey))).toBe(false)
  })

  test('copy outage returns typed failure after commit; identical collaborator retry repairs destination', async () => {
    await using h = await harness()
    await Effect.runPromise(
      h.show.create(
        {
          title: 'Retry',
          slug: 'retry',
          content: '',
          draft: true,
          thumbnailUrl: assetUrl(imageKey),
        },
        [actor.userId, collaborator.userId],
        actor,
      ),
    )
    h.fail(true)
    const payload = { draft: false, thumbnailUrl: assetUrl(imageKey) }

    const failed = await Effect.runPromise(
      h.show
        .update('retry', collaborator.userId, collaborator.userRole, payload)
        .pipe(Effect.result),
    )

    expect(Result.isFailure(failed) && failed.failure).toBeInstanceOf(S3Error)
    const [saved] = await h.db.select().from(showsTable).where(eq(showsTable.slug, 'retry'))
    expect(saved?.thumbnailUrl).toBe(assetUrl(publicKey(imageKey)))
    expect(saved?.draft).toBe(false)
    expect(h.objects.has(publicKey(imageKey))).toBe(false)
    h.fail(false)

    const repaired = await Effect.runPromise(
      h.show.update('retry', collaborator.userId, collaborator.userRole, payload),
    )

    expect(repaired.thumbnailUrl).toBe(saved?.thumbnailUrl)
    expect(h.objects.has(publicKey(imageKey))).toBe(true)
    expect(h.copies).toHaveLength(1)
  })

  test('audio create retries resume copying without duplicating the committed content', async () => {
    await using h = await harness()

    const data = {
      title: 'Audio',
      slug: 'audio',
      content: '',
      type: 'mix' as const,
      url: assetUrl(audioKey),
      thumbnailUrl: assetUrl(imageKey),
    }

    const options = { actorId: actor.userId, idempotencyKey: 'audio-retry' }
    h.fail(true)

    const failed = await Effect.runPromise(
      h.audio.create(data, [actor.userId], options).pipe(Effect.result),
    )

    expect(Result.isFailure(failed) && failed.failure).toBeInstanceOf(S3Error)
    h.fail(false)
    const repaired = await Effect.runPromise(h.audio.create(data, [actor.userId], options))
    expect(repaired.url).toBe(assetUrl(publicKey(audioKey)))
    expect(repaired.thumbnailUrl).toBe(assetUrl(publicKey(imageKey)))
    expect(await h.db.select().from(audioTable)).toHaveLength(1)
    expect(h.objects.get(publicKey(audioKey))).toBe('audio bytes')
  })

  test('a URL holder cannot attach another uploader private image even to a draft, or relabel it public', async () => {
    await using h = await harness()

    for (const draft of [true, false]) {
      for (const key of [imageKey, publicKey(imageKey)]) {
        const result = await Effect.runPromise(
          h.show
            .create(
              {
                title: 'Stolen',
                slug: `stolen-${draft}-${key.startsWith('public')}`,
                content: '',
                draft,
                thumbnailUrl: assetUrl(key),
              },
              [collaborator.userId],
              collaborator,
            )
            .pipe(Effect.result),
        )

        expect(Result.isFailure(result) && result.failure).toBeInstanceOf(UnauthorizedError)
      }
    }

    expect(await h.db.select().from(showsTable)).toEqual([])
    expect(h.copies).toEqual([])
  })

  test('already assigned creator can publish existing attachment but cannot introduce an unrelated private attachment', async () => {
    await using h = await harness()
    await Effect.runPromise(
      h.show.create(
        {
          title: 'Collaborative',
          slug: 'collaborative',
          content: '',
          draft: true,
          thumbnailUrl: assetUrl(imageKey),
        },
        [actor.userId, collaborator.userId],
        actor,
      ),
    )

    const denied = await Effect.runPromise(
      h.show
        .update('collaborative', collaborator.userId, collaborator.userRole, {
          bannerImageUrl: assetUrl(audioKey),
        })
        .pipe(Effect.result),
    )

    expect(Result.isFailure(denied) && denied.failure).toBeInstanceOf(UnauthorizedError)

    const published = await Effect.runPromise(
      h.show.update('collaborative', collaborator.userId, collaborator.userRole, { draft: false }),
    )

    expect(published.thumbnailUrl).toBe(assetUrl(publicKey(imageKey)))
  })

  test('post banners, art and inline images publish together; admin can attach another uploader original', async () => {
    await using h = await harness()

    const post = await Effect.runPromise(
      h.post.create(
        {
          title: 'Editorial',
          slug: 'editorial',
          type: 'post',
          content: `![cover](${assetUrl(imageKey)})`,
          thumbnailUrl: assetUrl(imageKey),
          bannerImageUrl: assetUrl(imageKey),
        },
        [collaborator.userId],
        { ...collaborator, userRole: 'admin' },
      ),
    )

    expect(post.thumbnailUrl).toBe(assetUrl(publicKey(imageKey)))
    expect(post.bannerImageUrl).toBe(assetUrl(publicKey(imageKey)))
    expect(attachedMediaUrls(post)).toEqual([
      assetUrl(publicKey(imageKey)),
      assetUrl(publicKey(imageKey)),
      assetUrl(publicKey(imageKey)),
    ])
    expect(h.copies).toHaveLength(1)
  })

  test('missing originals fail validation; existing legacy URLs require no storage lookup', async () => {
    const h = memoryStorage()
    const prepare = makeMediaPublication(config, h.store)

    const legacy = await Effect.runPromise(
      prepare({ thumbnailUrl: assetUrl('owner/legacy.png'), draft: false }, undefined),
    )

    await Effect.runPromise(legacy.publish)
    expect(h.heads).toEqual([])

    const missing = await Effect.runPromise(
      prepare({ thumbnailUrl: assetUrl('private/owner/image/missing/missing.png') }, actor).pipe(
        Effect.result,
      ),
    )

    expect(Result.isFailure(missing) && missing.failure).toBeInstanceOf(ValidationError)
    // Historical nonprivate objects stay public; this does not migrate old draft assets.
    expect(h.copies).toEqual([])
  })
})
