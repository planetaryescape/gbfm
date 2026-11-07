import { AuthSession } from '@gbfm/api/middleware/auth'
import { Effect } from 'effect'
import { expect, test } from 'vitest'

import { Database, makeDatabaseClient } from '@/db/layer'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { makeSessionCommandAuthority } from '@/mcp/command-authority'
import { createMcpOperationStore } from '@/mcp/operations/store'
import { ConfigService, createConfig } from '@/services/config.service'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { canonicalMusicWriteStatements, type CanonicalMusicWrite } from './guarded-write-statements'
import { parseMusicSource } from './music-source'
import { CanonicalMusicIdentityRepository } from './repository'
import type { WriteFence } from './repository-statements'

const playlistWrite = (
  expectedRevision = 0,
): Extract<CanonicalMusicWrite, { entityType: 'playlist' }> => ({
  entityType: 'playlist',
  entityId: 'p',
  expectedRevision,
  current: { title: 'Original', description: 'Keep', coverImageUrl: null },
  desired: {
    title: 'Prepared',
    description: 'Keep',
    coverImageUrl: 'https://art.example.test/one',
  },
})

const fixture = async (entityType: CanonicalMusicWrite['entityType'] = 'playlist') => {
  const resource = await createMigratedD1Database()
  const d1 = resource.database
  const db = makeDatabaseClient(d1)
  await seedMusicLookups(db)
  await d1.batch([
    d1.prepare(`INSERT INTO user(id,name,email,created_at,updated_at,role,banned)
      VALUES ('admin','Admin','canonical@example.test',1,1,'admin',0)`),
    d1
      .prepare(`INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at)
      VALUES ('s','disposable-canonical-session','admin',?,1,1)`)
      .bind(Date.now() + 3_600_000),
    d1.prepare(`INSERT INTO music_playlists(id,title,description,slug,createdAt,updatedAt)
      VALUES ('p','Original','Keep','p',1,1)`),
    d1.prepare(`INSERT INTO music_artists(id,name,slug,createdAt,updatedAt)
      VALUES ('a','Ada','a',1,1),('z','Zed','z',1,1)`),
    d1.prepare(`INSERT INTO music_albums(id,title,slug,artistNames,createdAt,updatedAt)
      VALUES ('album','Album','album','["Ada","Zed"]',1,1)`),
    d1.prepare(`INSERT INTO music_tracks(id,title,slug,artistNames,createdAt,updatedAt)
      VALUES ('track','Track','track','["Zed"]',1,1)`),
    d1.prepare(`INSERT INTO music_album_artists(albumId,artistId,displayOrder)
      VALUES ('album','a',0),('album','z',1)`),
    d1.prepare(
      `INSERT INTO music_track_artists(trackId,artistId,displayOrder) VALUES ('track','z',0)`,
    ),
  ])

  const authority = await Effect.runPromise(
    makeSessionCommandAuthority.pipe(
      Effect.provideService(AuthSession, {
        user: { id: 'admin', name: 'Admin', email: 'canonical@example.test' },
        session: { id: 's', createdAt: new Date() },
      }),
      Effect.provideService(Database, db),
      Effect.provideService(ConfigService, createConfig()),
    ),
  )

  const repository = new CanonicalMusicIdentityRepository(db)

  const source = await Effect.runPromise(
    parseMusicSource(`https://open.spotify.com/${entityType}/canonicalbuilder`, entityType),
  )

  const ownerToken = crypto.randomUUID()
  await Effect.runPromise(repository.claim(source, ownerToken, new Date(), 3_600_000))

  const fence: WriteFence = {
    ownedSources: [source],
    aliases: [],
    ownerToken,
    reference: {
      entityType,
      entityId: { playlist: 'p', artist: 'z', album: 'album', track: 'track' }[entityType],
    },
  }

  const store = createMcpOperationStore(d1)

  const apply = async (
    write: CanonicalMusicWrite,
    requestId = crypto.randomUUID(),
    sourceFence = fence,
    afterCheckpoint?: () => Promise<void>,
    afterAuthorization?: () => Promise<void>,
  ) => {
    const checkpoint = await Effect.runPromise(authority.checkpoint(['catalogue:write']))
    await afterCheckpoint?.()

    return store.execute({
      key: { ...checkpoint, operation: 'fixture_canonical_write', requestId },
      normalizedInput: {
        write,
        sourceKeys: [...sourceFence.ownedSources, ...sourceFence.aliases].map((s) => s.sourceKey),
      },
      now: Date.now(),
      authorize: async () => {
        const allowed = await Effect.runPromise(authority.checkpoint(['catalogue:write'])).then(
          () => true,
          () => false,
        )

        // Controlled competing writer after JS authorization, before the SQL batch.
        if (allowed && afterAuthorization) {
          await afterAuthorization()
          afterAuthorization = undefined
        }

        return allowed
      },
      build: (ctx) => {
        const plan = canonicalMusicWriteStatements({
          write,
          sourceFence,
          ctx,
          liveGuard: checkpoint.liveGuard,
          now: Date.now(),
        })

        return {
          ...plan,
          outcome: {
            result: { changed: plan.changed },
            revision: plan.revision,
            access: { entityId: write.entityId },
          },
        }
      },
    })
  }

  return { d1, db, apply, fence, source, repository, dispose: resource.dispose }
}

test('concurrent identical writes and a lost response replay the original receipt; changed payload conflicts', async () => {
  const f = await fixture()

  try {
    const requestId = crypto.randomUUID()

    const results = await Promise.all([
      f.apply(playlistWrite(), requestId),
      f.apply(playlistWrite(), requestId),
    ])

    expect(results.map((r) => r.status).sort()).toEqual(['applied', 'replayed'])
    const replay = await f.apply(playlistWrite(), requestId)
    expect(replay).toMatchObject({
      status: 'replayed',
      outcome: { result: { changed: true }, revision: 1 },
    })
    expect((await f.apply({ ...playlistWrite(), expectedRevision: 1 }, requestId)).status).toBe(
      'conflict',
    )
    expect(
      await f.d1
        .prepare(
          `SELECT title,description,coverImageUrl,revision FROM music_playlists WHERE id='p'`,
        )
        .first(),
    ).toEqual({
      title: 'Prepared',
      description: 'Keep',
      coverImageUrl: 'https://art.example.test/one',
      revision: 1,
    })
    expect(await f.d1.prepare(`SELECT count(*) AS n FROM mcp_operations`).first()).toEqual({
      n: 1,
    })
  } finally {
    await f.dispose()
  }
})

test('artwork never rebases the pinned revision or overwrites a changed observed value', async () => {
  const f = await fixture()

  try {
    await f.d1.prepare(`UPDATE music_playlists SET revision=1 WHERE id='p'`).run()
    expect((await f.apply(playlistWrite())).status).toBe('conflict')
    // A legacy writer changing values without revision advancement is excluded too.
    await f.d1
      .prepare(`UPDATE music_playlists SET revision=0,title='Concurrent' WHERE id='p'`)
      .run()
    expect((await f.apply(playlistWrite())).status).toBe('conflict')
    expect(
      await f.d1
        .prepare(`SELECT title,coverImageUrl,revision FROM music_playlists WHERE id='p'`)
        .first(),
    ).toEqual({ title: 'Concurrent', coverImageUrl: null, revision: 0 })
    expect(await f.d1.prepare(`SELECT count(*) AS n FROM mcp_operations`).first()).toEqual({
      n: 0,
    })
  } finally {
    await f.dispose()
  }
})

test('no-op writes prove the physical winner without advancing the public revision', async () => {
  const f = await fixture()

  try {
    const write: CanonicalMusicWrite = {
      ...playlistWrite(),
      desired: { title: 'Original', description: 'Keep', coverImageUrl: null },
    }

    expect(await f.apply(write)).toMatchObject({
      status: 'applied',
      outcome: { result: { changed: false }, revision: 0 },
    })
    expect(
      await f.d1
        .prepare(
          `SELECT revision,updatedAt,last_operation_id IS NOT NULL AS marked FROM music_playlists WHERE id='p'`,
        )
        .first(),
    ).toEqual({ revision: 0, updatedAt: 1, marked: 1 })
  } finally {
    await f.dispose()
  }
})

test('expired, stolen, empty, mismatched and aliased source fences fail without receipts', async () => {
  const f = await fixture()

  try {
    expect(
      (await f.apply(playlistWrite(), crypto.randomUUID(), { ...f.fence, ownedSources: [] }))
        .status,
    ).toBe('conflict')
    expect(
      (
        await f.apply(playlistWrite(), crypto.randomUUID(), {
          ...f.fence,
          reference: { entityType: 'playlist', entityId: 'other' },
        })
      ).status,
    ).toBe('conflict')
    expect(
      (
        await f.apply(playlistWrite(), crypto.randomUUID(), {
          ...f.fence,
          ownerToken: crypto.randomUUID(),
        })
      ).status,
    ).toBe('conflict')
    await f.d1.prepare(`UPDATE music_source_identities SET lease_expires_at=1`).run()
    expect((await f.apply(playlistWrite())).status).toBe('conflict')
    await f.d1
      .prepare(`UPDATE music_source_identities SET lease_expires_at=?`)
      .bind(Date.now() + 60_000)
      .run()

    const other = await Effect.runPromise(
      parseMusicSource('https://open.spotify.com/playlist/aliaswinner', 'playlist'),
    )

    await Effect.runPromise(f.repository.claim(other, crypto.randomUUID(), new Date(), 60_000))
    await f.d1
      .prepare(
        `INSERT INTO music_source_aliases(normalized_url,source_key,first_seen_at,last_seen_at) VALUES (?,?,1,1)`,
      )
      .bind(f.source.normalizedUrl, other.sourceKey)
      .run()
    expect((await f.apply(playlistWrite())).status).toBe('conflict')
    expect(
      await f.d1.prepare(`SELECT title,revision FROM music_playlists WHERE id='p'`).first(),
    ).toEqual({ title: 'Original', revision: 0 })
    expect(await f.d1.prepare(`SELECT count(*) AS n FROM mcp_operations`).first()).toEqual({
      n: 0,
    })
  } finally {
    await f.dispose()
  }
})

test('resolved unowned sources must resolve to the pinned target, and fresh authorization excludes revoked replay', async () => {
  const f = await fixture()

  try {
    await f.d1
      .prepare(`UPDATE music_source_identities SET state='resolved',owner_token=NULL,lease_expires_at=NULL,
      entity_type='playlist',entity_id='other',resolved_at=1`)
      .run()
    const fence = { ...f.fence, ownedSources: [], aliases: [f.source] }
    expect((await f.apply(playlistWrite(), crypto.randomUUID(), fence)).status).toBe('conflict')
    await f.d1.prepare(`UPDATE music_source_identities SET entity_id='p'`).run()
    const key = crypto.randomUUID()
    expect((await f.apply(playlistWrite(), key, fence)).status).toBe('applied')
    expect(
      (
        await f.apply(playlistWrite(), key, fence, async () => {
          await f.d1.prepare(`DELETE FROM session WHERE id='s'`).run()
        })
      ).status,
    ).toBe('access_denied')
  } finally {
    await f.dispose()
  }
})

test('persisted session expiry after JS authorization prevents both mutation and receipt', async () => {
  const f = await fixture()

  try {
    expect(
      (
        await f.apply(playlistWrite(), crypto.randomUUID(), f.fence, undefined, async () => {
          await f.d1.prepare(`UPDATE session SET expires_at=1 WHERE id='s'`).run()
        })
      ).status,
    ).toBe('conflict')
    expect(
      await f.d1.prepare(`SELECT title,revision FROM music_playlists WHERE id='p'`).first(),
    ).toEqual({ title: 'Original', revision: 0 })
    expect(await f.d1.prepare(`SELECT count(*) AS n FROM mcp_operations`).first()).toEqual({ n: 0 })
  } finally {
    await f.dispose()
  }
})

test.each(['album', 'track'] as const)(
  '%s metadata and artwork share the original-value CAS and root capacity guard',
  async (entityType) => {
    const f = await fixture(entityType)

    try {
      const title = entityType === 'album' ? 'Album' : 'Track'
      const table = entityType === 'album' ? 'music_albums' : 'music_tracks'

      const write: CanonicalMusicWrite = {
        entityType,
        entityId: entityType,
        expectedRevision: Number.MAX_SAFE_INTEGER,
        current: { title, coverImageUrl: null },
        desired: { title: 'Updated', coverImageUrl: 'https://art.example.test/new' },
      }

      const fence = { ...f.fence, reference: { entityType, entityId: entityType } }
      await f.d1.prepare(`UPDATE ${table} SET revision=?`).bind(Number.MAX_SAFE_INTEGER).run()
      expect((await f.apply(write, crypto.randomUUID(), fence)).status).toBe('conflict')
      await f.d1.prepare(`UPDATE ${table} SET revision=0`).run()
      expect(
        (await f.apply({ ...write, expectedRevision: 0 }, crypto.randomUUID(), fence)).status,
      ).toBe('applied')
      expect(
        await f.d1.prepare(`SELECT title,coverImageUrl,revision FROM ${table}`).first(),
      ).toEqual({
        title: 'Updated',
        coverImageUrl: 'https://art.example.test/new',
        revision: 1,
      })
    } finally {
      await f.dispose()
    }
  },
)

test('artist rename projects ordered dependent names atomically; alias and capacity failures preserve all rows', async () => {
  const f = await fixture('artist')

  try {
    const fence = { ...f.fence, reference: { entityType: 'artist' as const, entityId: 'z' } }

    const write: CanonicalMusicWrite = {
      entityType: 'artist',
      entityId: 'z',
      expectedRevision: 0,
      current: { name: 'Zed', imageUrl: null },
      desired: { name: 'Renamed', imageUrl: null },
    }

    await f.d1
      .prepare(`UPDATE music_tracks SET revision=? WHERE id='track'`)
      .bind(Number.MAX_SAFE_INTEGER)
      .run()
    expect((await f.apply(write, crypto.randomUUID(), fence)).status).toBe('conflict')
    expect(
      await f.d1.prepare(`SELECT name,revision FROM music_artists WHERE id='z'`).first(),
    ).toEqual({ name: 'Zed', revision: 0 })
    expect(
      await f.d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='album'`).first(),
    ).toEqual({ artistNames: '["Ada","Zed"]', revision: 0 })
    await f.d1.prepare(`UPDATE music_tracks SET revision=0 WHERE id='track'`).run()
    await f.d1
      .prepare(`INSERT INTO music_artist_aliases(id,artist_id,name,name_key,source_label,evidence_note,asserted_at,created_at)
      VALUES ('alias','z','Renamed','renamed','Manual','Keep',1,1)`)
      .run()
    expect((await f.apply(write, crypto.randomUUID(), fence)).status).toBe('conflict')
    await f.d1.prepare(`DELETE FROM music_artist_aliases WHERE id='alias'`).run()
    expect((await f.apply(write, crypto.randomUUID(), fence)).status).toBe('applied')
    expect(
      await f.d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='album'`).first(),
    ).toEqual({ artistNames: '["Ada","Renamed"]', revision: 1 })
    expect(
      await f.d1.prepare(`SELECT artistNames,revision FROM music_tracks WHERE id='track'`).first(),
    ).toEqual({ artistNames: '["Renamed"]', revision: 1 })
  } finally {
    await f.dispose()
  }
})
