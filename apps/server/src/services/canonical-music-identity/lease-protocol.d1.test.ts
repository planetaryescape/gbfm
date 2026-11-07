import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { expect, test } from 'vitest'

import { makeDatabaseClient } from '@/db/layer'
import { musicSourceIdentitiesTable } from '@/db/music-entity.schema'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { parseMusicSource } from './music-source'
import { CanonicalMusicIdentityRepository, ClaimResult } from './repository'

test('lease expiry is strict and stale owners cannot renew or release a reclaimed source', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await seedMusicLookups(db)
  const repository = new CanonicalMusicIdentityRepository(db)

  const source = await Effect.runPromise(
    parseMusicSource('https://open.spotify.com/track/leaseprotocol', 'track'),
  )

  const now = new Date('2026-01-01T00:00:00.000Z')
  const expiresAt = new Date(now.getTime() + 1000)

  expect(await Effect.runPromise(repository.claim(source, 'first', now, 1000))).toEqual(
    ClaimResult.owned({ result: 'miss' }),
  )
  expect(await Effect.runPromise(repository.claim(source, 'second', expiresAt, 1000))).toEqual(
    ClaimResult.busy({ retryAfterMs: 1, claimAgeMs: 1000 }),
  )

  const reclaimedAt = new Date(expiresAt.getTime() + 1)
  expect(await Effect.runPromise(repository.claim(source, 'second', reclaimedAt, 1000))).toEqual(
    ClaimResult.owned({ result: 'reclaimed', claimAgeMs: 1001 }),
  )
  expect(
    await Effect.runPromise(repository.renew([source.sourceKey], 'first', reclaimedAt, 1000)),
  ).toEqual([])
  await Effect.runPromise(repository.release([source.sourceKey], 'first'))

  const [retained] = await db
    .select()
    .from(musicSourceIdentitiesTable)
    .where(eq(musicSourceIdentitiesTable.sourceKey, source.sourceKey))

  expect(retained).toMatchObject({ state: 'resolving', ownerToken: 'second' })
  expect(retained?.leaseExpiresAt).toEqual(new Date(reclaimedAt.getTime() + 1000))

  expect(
    await Effect.runPromise(repository.renew([source.sourceKey], 'second', reclaimedAt, 2000)),
  ).toEqual([{ sourceKey: source.sourceKey }])
  await Effect.runPromise(repository.release([source.sourceKey], 'second'))
  expect(
    await db
      .select()
      .from(musicSourceIdentitiesTable)
      .where(eq(musicSourceIdentitiesTable.sourceKey, source.sourceKey)),
  ).toEqual([])
})
