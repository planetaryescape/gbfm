import { randomUUID } from 'node:crypto'

import { count, eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { beforeAll, describe, expect, test } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import { showsTable } from '@/db/show.schema'
import { CryptoLive } from '@/lib/crypto'
import { MdxServiceLayer } from '@/lib/mdx'
import { ConfigServiceLayer } from '@/services/config.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { AudioService, AudioServiceLayer, createAudioFingerprint } from './audio.service'

const actorId = `audio-idempotency-${randomUUID()}`

const otherActorId = `audio-other-${randomUUID()}`

const makeAudio = (slug: string) => ({
  title: `Audio ${slug}`,
  slug,
  content: '',
  type: 'mix' as const,
  url: 'https://example.com/audio.mp3',
})

const getService = () =>
  Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        return yield* AudioService
      }),
      AudioServiceLayer.pipe(
        Layer.provide(MdxServiceLayer),
        Layer.provide(UnavailableObjectStoreClientLayer),
        Layer.provide(Layer.mergeAll(ConfigServiceLayer, UploadAssetServiceLayer)),
        Layer.provide(DatabaseTestLayer),
      ),
    ),
  )

beforeAll(async () => {
  await db.insert(user).values([
    {
      id: actorId,
      name: 'Audio idempotency actor',
      email: `${actorId}@example.com`,
    },
    {
      id: otherActorId,
      name: 'Audio other actor',
      email: `${otherActorId}@example.com`,
    },
  ])
})

describe('AudioService.getByTypeForEdit visibility', () => {
  test('returns only the non-admin actor own audio', async () => {
    const service = await getService()
    const ownSlug = `own-${randomUUID()}`
    const otherSlug = `other-${randomUUID()}`

    const own = await Effect.runPromise(
      service.create(makeAudio(ownSlug), [actorId], { actorId, idempotencyKey: randomUUID() }),
    )

    const other = await Effect.runPromise(
      service.create(makeAudio(otherSlug), [otherActorId], {
        actorId: otherActorId,
        idempotencyKey: randomUUID(),
      }),
    )

    const { data } = await Effect.runPromise(
      service.getByTypeForEdit('mix', { limit: 200, offset: 0 }, actorId, 'user'),
    )

    const ids = data.map((audio) => audio.id)

    expect(ids).toContain(own.id)
    expect(ids).not.toContain(other.id)
  })

  test('returns audio owned by others for an admin actor', async () => {
    const service = await getService()
    const otherSlug = `admin-view-${randomUUID()}`

    const other = await Effect.runPromise(
      service.create(makeAudio(otherSlug), [otherActorId], {
        actorId: otherActorId,
        idempotencyKey: randomUUID(),
      }),
    )

    const { data } = await Effect.runPromise(
      service.getByTypeForEdit('mix', { limit: 200, offset: 0 }, actorId, 'admin'),
    )

    expect(data.map((audio) => audio.id)).toContain(other.id)
  })
})

describe('AudioService.getBySlug draft visibility', () => {
  test('returns a draft to its creator', async () => {
    const service = await getService()
    const slug = `own-draft-${randomUUID()}`

    await Effect.runPromise(
      service.create({ ...makeAudio(slug), draft: true }, [actorId], {
        actorId,
        idempotencyKey: randomUUID(),
      }),
    )

    const audio = await Effect.runPromise(
      service.getBySlug('mix', slug, { userId: actorId, userRole: 'user' }),
    )

    expect(audio.slug).toBe(slug)
  })

  test('returns another creator draft to an admin', async () => {
    const service = await getService()
    const slug = `admin-draft-${randomUUID()}`

    await Effect.runPromise(
      service.create({ ...makeAudio(slug), draft: true }, [otherActorId], {
        actorId: otherActorId,
        idempotencyKey: randomUUID(),
      }),
    )

    const audio = await Effect.runPromise(
      service.getBySlug('mix', slug, { userId: actorId, userRole: 'admin' }),
    )

    expect(audio.slug).toBe(slug)
  })
})

describe('AudioService.create idempotency', () => {
  test('normalizes creator order without hiding changed content', async () => {
    const audio = makeAudio('fingerprint')

    const fingerprint = (
      data: Parameters<typeof createAudioFingerprint>[0],
      creatorIds: ReadonlyArray<string>,
    ) => Effect.runPromise(withTestLayer(createAudioFingerprint(data, creatorIds), CryptoLive))

    const expected = '6bbe8d50ac398413bfdef5265398942d41fca558630cc40ae888a5bb68105084'

    expect(await fingerprint(audio, ['b', 'a'])).toBe(expected)
    expect(await fingerprint({ ...audio, description: undefined }, ['a', 'b'])).toBe(expected)
    expect(await fingerprint(audio, ['a'])).not.toBe(
      await fingerprint({ ...audio, title: 'Changed' }, ['a']),
    )
  })

  test('replays the original row when a retry uses the same actor, key, and request', async () => {
    const service = await getService()
    const slug = `retry-${randomUUID()}`
    const idempotencyKey = randomUUID()

    const first = await Effect.runPromise(
      service.create(makeAudio(slug), [actorId], { actorId, idempotencyKey }),
    )

    const replay = await Effect.runPromise(
      service.create(makeAudio(slug), [actorId], {
        actorId,
        idempotencyKey,
      }),
    )

    expect(replay.id).toBe(first.id)
    expect(replay.title).toBe(first.title)
  })

  test('rejects reuse of an idempotency key for a changed request', async () => {
    const service = await getService()
    const slug = `changed-${randomUUID()}`
    const idempotencyKey = randomUUID()

    await Effect.runPromise(service.create(makeAudio(slug), [actorId], { actorId, idempotencyKey }))

    await expect(
      Effect.runPromise(
        service.create({ ...makeAudio(slug), title: 'Changed retry body' }, [actorId], {
          actorId,
          idempotencyKey,
        }),
      ),
    ).rejects.toMatchObject({ resource: 'audio' })
  })

  test('atomically replays one row across concurrent create attempts', async () => {
    const service = await getService()
    const slug = `concurrent-${randomUUID()}`
    const idempotencyKey = randomUUID()

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        Effect.runPromise(service.create(makeAudio(slug), [actorId], { actorId, idempotencyKey })),
      ),
    )

    const [rowCount] = await db
      .select({ count: count() })
      .from(audioTable)
      .where(eq(audioTable.slug, slug))

    expect(new Set(results.map((audio) => audio.id)).size).toBe(1)
    expect(rowCount?.count).toBe(1)
  })

  test('keeps a natural-key collision with a different key as a conflict', async () => {
    const service = await getService()
    const slug = `conflict-${randomUUID()}`

    await Effect.runPromise(
      service.create(makeAudio(slug), [actorId], {
        actorId,
        idempotencyKey: randomUUID(),
      }),
    )

    await expect(
      Effect.runPromise(
        service.create(makeAudio(slug), [actorId], {
          actorId,
          idempotencyKey: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ resource: 'audio' })
  })
})

describe('AudioService creators', () => {
  test('getByType and getBySlug attach the creator for each audio row', async () => {
    const service = await getService()
    const slug = `creators-${randomUUID()}`

    const created = await Effect.runPromise(
      service.create(makeAudio(slug), [actorId], {
        actorId,
        idempotencyKey: randomUUID(),
      }),
    )

    const bySlug = await Effect.runPromise(service.getBySlug('mix', slug))
    expect(bySlug.creators).toEqual([
      expect.objectContaining({ id: actorId, name: 'Audio idempotency actor' }),
    ])

    const { data: byType } = await Effect.runPromise(
      service.getByType('mix', { limit: 100, offset: 0 }),
    )

    const match = byType.find((audio) => audio.id === created.id)
    expect(match?.creators).toEqual([
      expect.objectContaining({ id: actorId, name: 'Audio idempotency actor' }),
    ])
  })
})

const makeShow = async (thumbnailUrl: string | null) => {
  const slug = `show-${randomUUID()}`

  const [show] = await db
    .insert(showsTable)
    .values({
      title: `Show ${slug}`,
      slug,
      content: '',
      thumbnailUrl,
    })
    .returning()

  if (!show) {
    throw new Error('Failed to insert show fixture')
  }

  return show
}

describe('AudioService show thumbnailUrl fallback', () => {
  test('persists NULL when created with a showId and no thumbnailUrl of its own', async () => {
    const service = await getService()
    const show = await makeShow('https://example.com/show-art.png')
    const slug = `no-thumbnail-${randomUUID()}`

    const created = await Effect.runPromise(
      service.create({ ...makeAudio(slug), showId: show.id }, [actorId], {
        actorId,
        idempotencyKey: randomUUID(),
      }),
    )

    const [row] = await db.select().from(audioTable).where(eq(audioTable.id, created.id))
    expect(row?.thumbnailUrl).toBeNull()
  })

  test('getByType and getBySlug fall back to the show current thumbnailUrl', async () => {
    const service = await getService()
    const show = await makeShow('https://example.com/show-art.png')
    const slug = `fallback-${randomUUID()}`

    const created = await Effect.runPromise(
      service.create({ ...makeAudio(slug), showId: show.id }, [actorId], {
        actorId,
        idempotencyKey: randomUUID(),
      }),
    )

    const bySlug = await Effect.runPromise(service.getBySlug('mix', slug))
    expect(bySlug.thumbnailUrl).toBe('https://example.com/show-art.png')

    const { data: byType } = await Effect.runPromise(
      service.getByType('mix', { limit: 100, offset: 0 }),
    )

    const match = byType.find((audio) => audio.id === created.id)
    expect(match?.thumbnailUrl).toBe('https://example.com/show-art.png')
  })

  test('reflects the show new thumbnailUrl after the show art changes, not a stale copy', async () => {
    const service = await getService()
    const show = await makeShow('https://example.com/old-show-art.png')
    const slug = `stale-check-${randomUUID()}`

    await Effect.runPromise(
      service.create({ ...makeAudio(slug), showId: show.id }, [actorId], {
        actorId,
        idempotencyKey: randomUUID(),
      }),
    )

    await db
      .update(showsTable)
      .set({ thumbnailUrl: 'https://example.com/new-show-art.png' })
      .where(eq(showsTable.id, show.id))

    const bySlug = await Effect.runPromise(service.getBySlug('mix', slug))
    expect(bySlug.thumbnailUrl).toBe('https://example.com/new-show-art.png')
  })

  test('keeps its own explicit thumbnailUrl instead of the show artwork', async () => {
    const service = await getService()
    const show = await makeShow('https://example.com/show-art.png')
    const slug = `own-thumbnail-${randomUUID()}`

    const created = await Effect.runPromise(
      service.create(
        {
          ...makeAudio(slug),
          showId: show.id,
          thumbnailUrl: 'https://example.com/own-art.png',
        },
        [actorId],
        { actorId, idempotencyKey: randomUUID() },
      ),
    )

    const [row] = await db.select().from(audioTable).where(eq(audioTable.id, created.id))
    expect(row?.thumbnailUrl).toBe('https://example.com/own-art.png')

    const bySlug = await Effect.runPromise(service.getBySlug('mix', slug))
    expect(bySlug.thumbnailUrl).toBe('https://example.com/own-art.png')
  })
})
