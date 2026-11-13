import { randomUUID } from 'node:crypto'

import { inArray } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { MdxServiceLayer } from '@/lib/mdx'
import { ConfigServiceLayer } from '@/services/config.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { DatabaseTestLayer, db } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { AudioService, AudioServiceLayer } from './audio.service'

const slugPrefix = `audio-sort-${randomUUID().slice(0, 8)}`

const seeded = [
  { playCount: 5, minutesAgo: 40 },
  { playCount: 90, minutesAgo: 30 },
  { playCount: 1, minutesAgo: 20 },
  { playCount: 42, minutesAgo: 10 },
].map((row, index) => ({
  ...row,
  id: randomUUID(),
  slug: `${slugPrefix}-${index}`,
}))

const seededIds = seeded.map((row) => row.id)

const seededSlugs = new Set(seeded.map((row) => row.slug))

const slugAt = (index: number) => `${slugPrefix}-${index}`

const adminId = `audio-sort-admin-${randomUUID()}`

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

const fetchSeeded = async (
  options: {
    sort?: 'plays' | 'created'
    order?: 'asc' | 'desc'
  } = {},
) => {
  const service = await getService()

  const result = await Effect.runPromise(
    service.getByTypeForEdit('mix', { limit: 100, offset: 0, ...options }, adminId, 'admin'),
  )

  return result.data.filter((audio) => seededSlugs.has(audio.slug)).map((audio) => audio.slug)
}

beforeAll(async () => {
  const now = Date.now()
  await db.insert(audioTable).values(
    seeded.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: `Sort fixture ${row.slug}`,
      content: '',
      type: 'mix' as const,
      url: 'https://example.com/audio.mp3',
      draft: false,
      playCount: row.playCount,
      createdAt: new Date(now - row.minutesAgo * 60_000),
    })),
  )
})

afterAll(async () => {
  await db.delete(audioTable).where(inArray(audioTable.id, seededIds))
})

describe('AudioService.getByTypeForEdit ordering', () => {
  test('browses newest first by default and can reverse chronological order', async () => {
    expect(await fetchSeeded()).toEqual([3, 2, 1, 0].map(slugAt))
    expect(await fetchSeeded({ sort: 'created', order: 'asc' })).toEqual([0, 1, 2, 3].map(slugAt))
  })

  test('changes popularity order and preserves global ranking while paging', async () => {
    expect(await fetchSeeded({ sort: 'plays', order: 'desc' })).toEqual([1, 3, 0, 2].map(slugAt))
    expect(await fetchSeeded({ sort: 'plays', order: 'asc' })).toEqual([2, 0, 3, 1].map(slugAt))
    const service = await getService()

    const unsorted = await Effect.runPromise(
      service.getByTypeForEdit('mix', { limit: 100, offset: 0 }, adminId, 'admin'),
    )

    const total = unsorted.pagination.total

    const pageSize = 1
    const collected: Array<string> = []

    for (let offset = 0; offset < total; offset += pageSize) {
      const page = await Effect.runPromise(
        service.getByTypeForEdit(
          'mix',
          { limit: pageSize, offset, sort: 'plays', order: 'desc' },
          adminId,
          'admin',
        ),
      )

      for (const audio of page.data) {
        if (seededSlugs.has(audio.slug)) collected.push(audio.slug)
      }
    }

    expect(collected).toEqual([slugAt(1), slugAt(3), slugAt(0), slugAt(2)])
  })
})
