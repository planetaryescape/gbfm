import { AuthSession } from '@gbfm/api/middleware/auth'
import { sql } from 'drizzle-orm'
import { Effect, Layer, type Schema } from 'effect'
import { expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { Database, makeDatabaseClient } from '@/db/layer'
import { seedMusicLookups } from '@/db/seed-music-lookups'
import { makeSessionCommandAuthority } from '@/mcp/command-authority'
import { createMusicEditExecutor } from '@/mcp/music-edit/executor'
import { McpOperationStore, createMcpOperationStore } from '@/mcp/operations/store'
import { ConfigService, createConfig } from '@/services/config.service'
import { createTestWebHandler } from '@/test/http-handler'
import { createMigratedD1Database } from '@/test/migrate-d1'

test('session relationship writes fence billing and both affiliation roots, replay and roll back together', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db
    .insert(user)
    .values({ id: 'admin', name: 'Admin', email: 'relationships@test.example', role: 'admin' })
  await db.insert(session).values({
    id: 'session',
    userId: 'admin',
    token: 'relationship-token',
    expiresAt: new Date(Date.now() + 120_000),
  })
  await db.run(
    sql`INSERT INTO music_artists(id,name,slug,createdAt,updatedAt) VALUES ('a','A','a',1,1),('b','B','b',1,1),('c','C','c',1,1)`,
  )
  await db.run(
    sql`INSERT INTO music_albums(id,title,slug,artistNames,createdAt,updatedAt) VALUES ('x','X','x','["B"]',1,1),('y','Y','y','[]',1,1)`,
  )
  await db.run(
    sql`INSERT INTO music_tracks(id,title,slug,artistNames,createdAt,updatedAt) VALUES ('t','T','t','["B"]',1,1)`,
  )
  await db.run(
    sql`INSERT INTO music_album_artists(albumId,artistId,displayOrder) VALUES ('x','b',0)`,
  )
  await db.run(
    sql`INSERT INTO music_track_artists(trackId,artistId,displayOrder) VALUES ('t','b',0)`,
  )
  await db.run(
    sql`INSERT INTO music_labels(id,name,slug,created_at,updated_at) VALUES ('l','L','l',1,1),('m','M','m',1,1)`,
  )
  const web = createTestWebHandler(resource.database)

  const call = (
    path: string,
    method: 'PUT' | 'DELETE',
    headers: Record<string, string> = {},
    body?: Schema.Json,
  ) =>
    web.handler(
      new Request(`http://localhost/api/music/${path}`, {
        method,
        headers: {
          authorization: 'Bearer relationship-token',
          'content-type': 'application/json',
          ...headers,
        },
        body: body === undefined ? null : JSON.stringify(body),
      }),
    )

  const intent = (revision: number, referenceHeader: string, referenceRevision: number) => ({
    'x-gbfm-music-revision': String(revision),
    'x-gbfm-request-id': crypto.randomUUID(),
    [referenceHeader]: String(referenceRevision),
  })

  try {
    for (const [collection, id, table] of [
      ['albums', 'x', 'music_albums'],
      ['tracks', 't', 'music_tracks'],
    ] as const) {
      const path = `${collection}/${id}/artists/a`

      const add = {
        expectedRevision: 0,
        requestId: crypto.randomUUID(),
        references: [{ entityType: 'artist', entityId: 'a', expectedRevision: 0 }],
        role: 'producer',
        displayOrder: 2,
      }

      expect((await call(path, 'PUT', {}, {})).status).toBe(428)
      expect((await call(path, 'PUT', {}, add)).status).toBe(204)
      expect(
        await db.get(sql`SELECT artistNames,revision FROM ${sql.identifier(table)} WHERE id=${id}`),
      ).toEqual({ artistNames: '["B","A"]', revision: 1 })
      expect(
        (
          await call(
            path,
            'PUT',
            {},
            { ...add, expectedRevision: 1, requestId: crypto.randomUUID() },
          )
        ).status,
      ).toBe(204)
      expect(
        await db.get(sql`SELECT revision FROM ${sql.identifier(table)} WHERE id=${id}`),
      ).toEqual({ revision: 1 })
      expect(
        (await call(path, 'DELETE', intent(1, 'x-gbfm-music-artist-revision', 1))).status,
      ).toBe(409)
      expect(
        (
          await call(path, 'DELETE', {
            'x-gbfm-music-revision': '1',
            'x-gbfm-request-id': crypto.randomUUID(),
          })
        ).status,
      ).toBe(428)
      expect(
        (
          await call(path, 'DELETE', {
            ...intent(1, 'x-gbfm-music-artist-revision', 0),
            'x-gbfm-music-artist-revision': '1e0',
          })
        ).status,
      ).toBe(400)
      const remove = intent(1, 'x-gbfm-music-artist-revision', 0)
      expect((await call(path, 'DELETE', remove)).status).toBe(204)
      expect((await call(path, 'DELETE', remove)).status).toBe(204)
      expect((await call(path, 'PUT', {}, add)).status).toBe(204)
      expect(
        await db.get(sql`SELECT artistNames,revision FROM ${sql.identifier(table)} WHERE id=${id}`),
      ).toEqual({ artistNames: '["B"]', revision: 2 })
      const beforeFailure = await db.get(sql`SELECT count(*) AS total FROM mcp_operations`)
      await db.run(sql`CREATE TRIGGER fail_projection BEFORE UPDATE OF artistNames ON ${sql.identifier(table)}
        BEGIN SELECT RAISE(ABORT,'injected projection failure'); END`)
      expect(
        (
          await call(
            path,
            'PUT',
            {},
            { ...add, expectedRevision: 2, requestId: crypto.randomUUID() },
          )
        ).status,
      ).toBe(503)
      expect(
        await db.get(sql`SELECT artistNames,revision FROM ${sql.identifier(table)} WHERE id=${id}`),
      ).toEqual({ artistNames: '["B"]', revision: 2 })

      const junction = sql.identifier(
        collection === 'albums' ? 'music_album_artists' : 'music_track_artists',
      )

      const parent = sql.identifier(collection === 'albums' ? 'albumId' : 'trackId')
      expect(await db.all(sql`SELECT artistId FROM ${junction} WHERE ${parent}=${id}`)).toEqual([
        { artistId: 'b' },
      ])
      expect(await db.get(sql`SELECT count(*) AS total FROM mcp_operations`)).toEqual(beforeFailure)
      await db.run(sql`DROP TRIGGER fail_projection`)
    }

    for (const [collection, id, table, labelRevision] of [
      ['artists', 'a', 'music_artists', 0],
      ['albums', 'y', 'music_albums', 2],
    ] as const) {
      const path = `labels/l/${collection}/${id}`
      expect((await call(path, 'PUT')).status).toBe(428)
      expect(
        (await call(path, 'PUT', intent(0, 'x-gbfm-music-label-revision', labelRevision + 1)))
          .status,
      ).toBe(409)
      const add = intent(0, 'x-gbfm-music-label-revision', labelRevision)
      expect((await call(path, 'PUT', add)).status).toBe(204)
      expect((await call(path, 'PUT', add)).status).toBe(204)
      expect(
        (await call(path, 'PUT', intent(1, 'x-gbfm-music-label-revision', labelRevision + 1)))
          .status,
      ).toBe(204)
      expect(
        await db.get(sql`SELECT revision FROM ${sql.identifier(table)} WHERE id=${id}`),
      ).toEqual({ revision: 1 })
      expect(await db.get(sql`SELECT revision FROM music_labels WHERE id='l'`)).toEqual({
        revision: labelRevision + 1,
      })
      const remove = intent(1, 'x-gbfm-music-label-revision', labelRevision + 1)
      expect((await call(path, 'DELETE', remove)).status).toBe(204)
      expect((await call(path, 'DELETE', remove)).status).toBe(204)
      expect((await call(path, 'PUT', add)).status).toBe(204)
      expect(
        await db.get(sql`SELECT revision FROM ${sql.identifier(table)} WHERE id=${id}`),
      ).toEqual({ revision: 2 })
      expect(await db.get(sql`SELECT revision FROM music_labels WHERE id='l'`)).toEqual({
        revision: labelRevision + 2,
      })
    }

    const races = await Promise.all([
      call('labels/l/artists/b', 'PUT', intent(0, 'x-gbfm-music-label-revision', 4)),
      call('labels/l/albums/x', 'PUT', intent(2, 'x-gbfm-music-label-revision', 4)),
    ])

    expect(races.map((response) => response.status).sort((left, right) => left - right)).toEqual([
      204, 409,
    ])
    expect(await db.get(sql`SELECT revision FROM music_labels WHERE id='l'`)).toEqual({
      revision: 5,
    })
    expect(
      await db.get(
        sql`SELECT (SELECT count(*) FROM music_label_artists)+(SELECT count(*) FROM music_label_albums) AS total`,
      ),
    ).toEqual({ total: 1 })
    expect(
      await db.get(
        sql`SELECT revision,last_operation_id AS lastOperationId FROM music_labels WHERE id='m'`,
      ),
    ).toEqual({ revision: 0, lastOperationId: null })
    const receiptsBeforeFailure = await db.get(sql`SELECT count(*) AS total FROM mcp_operations`)
    await db.run(
      sql`CREATE TRIGGER fail_affiliation BEFORE INSERT ON music_label_artists WHEN NEW.artist_id='c' BEGIN SELECT RAISE(ABORT,'injected storage failure'); END`,
    )
    const failed = intent(0, 'x-gbfm-music-label-revision', 0)
    expect((await call('labels/m/artists/c', 'PUT', failed)).status).toBe(503)
    expect(
      await db.get(
        sql`SELECT revision,last_operation_id AS lastOperationId FROM music_labels WHERE id='m'`,
      ),
    ).toEqual({ revision: 0, lastOperationId: null })
    expect(
      await db.get(
        sql`SELECT revision,last_operation_id AS lastOperationId FROM music_artists WHERE id='c'`,
      ),
    ).toEqual({ revision: 0, lastOperationId: null })
    expect(await db.get(sql`SELECT count(*) AS total FROM mcp_operations`)).toEqual(
      receiptsBeforeFailure,
    )
    await db.run(sql`DROP TRIGGER fail_affiliation`)
    expect((await call('labels/m/artists/c', 'PUT', failed)).status).toBe(204)
    await db.update(user).set({ role: 'user' })
    expect((await call('labels/m/artists/c', 'PUT', failed)).status).toBe(403)
  } finally {
    await web.dispose()
  }
}, 30_000)

test('real session HTTP metadata uses observed intent, preserves browser fields and races safely with MCP', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db
    .insert(user)
    .values({ id: 'admin', name: 'Admin', email: 'admin@test.example', role: 'admin' })
  await db.insert(session).values({
    id: 'session',
    userId: 'admin',
    token: 'session-token',
    expiresAt: new Date(Date.now() + 60_000),
  })
  await db.run(sql`INSERT INTO music_artists(id,name,slug,bio,imageUrl,publishedAt,createdAt,updatedAt)
    VALUES ('a','Before','before','manual biography','https://example.test/art.png',123,1,1)`)
  await db.run(sql`INSERT INTO music_albums(id,title,slug,artistNames,createdAt,updatedAt)
    VALUES ('album','Album','album','["Before"]',1,1),('other','Other','other','[]',1,1)`)
  await db.run(
    sql`INSERT INTO music_album_artists(albumId,artistId,displayOrder) VALUES ('album','a',0)`,
  )
  await db.run(sql`INSERT INTO labels(id,kind,name) VALUES ('tag','tag','Retain')`)
  await db.run(
    sql`INSERT INTO entity_labels(entity_type,entity_id,label_id,position) VALUES ('artist','a','tag',0)`,
  )
  await db.run(sql`INSERT INTO music_artist_aliases(id,artist_id,name,name_key,source_label,evidence_note,asserted_at,created_at)
    VALUES ('alias','a','Stage','stage','Manual','Keep evidence',1,1)`)
  const config = createConfig()

  const web = createTestWebHandler(
    resource.database,
    undefined,
    undefined,
    undefined,
    Layer.succeed(ConfigService, config),
  )

  const patch = (payload: Schema.Json, id = 'a') =>
    web.handler(
      new Request(`http://localhost/api/music/artists/${id}`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    )

  try {
    expect((await patch({ name: 'Missing intent' })).status).toBe(428)
    expect(
      (await patch({ requestId: 'not-a-uuid', expectedRevision: 0, name: 'Invalid' })).status,
    ).toBe(400)

    const command = {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      name: 'Renamed',
      genres: ['Jazz', 'Jazz', 'Ambient'],
    }

    const response = await patch(command)
    expect(response.status).toBe(200)
    const saved = await response.json()
    expect(saved).toMatchObject({
      name: 'Renamed',
      revision: 1,
      bio: 'manual biography',
      imageUrl: 'https://example.test/art.png',
      publishedAt: new Date(123).toISOString(),
      genres: ['Jazz', 'Ambient'],
    })
    expect(saved).not.toHaveProperty('lastOperationId')
    expect(
      await db.get(sql`SELECT artistNames,revision FROM music_albums WHERE id='album'`),
    ).toEqual({ artistNames: '["Renamed"]', revision: 1 })
    expect(
      await db.get(sql`SELECT artistNames,revision FROM music_albums WHERE id='other'`),
    ).toEqual({ artistNames: '[]', revision: 0 })
    expect(
      await db.get(sql`SELECT evidence_note FROM music_artist_aliases WHERE id='alias'`),
    ).toEqual({ evidence_note: 'Keep evidence' })
    expect(
      await db.get(
        sql`SELECT count(*) AS total FROM entity_labels WHERE entity_id='a' AND label_id='tag'`,
      ),
    ).toEqual({ total: 1 })

    expect(
      (await patch({ requestId: crypto.randomUUID(), expectedRevision: 1, name: 'STAGE' })).status,
    ).toBe(409)

    const authority = await Effect.runPromise(
      makeSessionCommandAuthority.pipe(
        Effect.provideService(AuthSession, {
          user: { id: 'admin', name: 'Admin', email: 'admin@test.example' },
          session: { id: 'session', createdAt: new Date() },
        }),
        Effect.provideService(Database, db),
        Effect.provideService(ConfigService, config),
      ),
    )

    const executor = createMusicEditExecutor(authority.checkpoint)

    const mcp = () =>
      Effect.runPromise(
        executor
          .apply(
            {
              requestId: crypto.randomUUID(),
              expectedRevision: 1,
              references: [],
              change: {
                operation: 'update_music_metadata',
                entityType: 'artist',
                entityId: 'a',
                metadata: { bio: 'MCP winner' },
              },
            },
            Date.now(),
          )
          .pipe(
            Effect.provideService(Database, db),
            Effect.provideService(McpOperationStore, createMcpOperationStore(resource.database)),
          ),
      )

    const [browser, mcpResult] = await Promise.all([
      patch({ requestId: crypto.randomUUID(), expectedRevision: 1, bio: 'Browser winner' }),
      mcp(),
    ])

    expect(Number(browser.status === 200) + Number(mcpResult.status === 'applied')).toBe(1)
    expect(browser.status === 409 || mcpResult.status === 'conflict').toBe(true)
    expect(await db.get(sql`SELECT revision FROM music_artists WHERE id='a'`)).toEqual({
      revision: 2,
    })
    const replay = await patch(command)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(saved)
    expect(
      (await patch({ requestId: crypto.randomUUID(), expectedRevision: 0, bio: 'stale' })).status,
    ).toBe(409)
    expect(
      (
        await patch(
          { requestId: crypto.randomUUID(), expectedRevision: 0, bio: 'absent' },
          'missing',
        )
      ).status,
    ).toBe(404)
  } finally {
    await web.dispose()
  }
}, 20_000)

test('album, track and label metadata preserve browser fields, observed relationships and original receipt results', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db
    .insert(user)
    .values({ id: 'admin', name: 'Admin', email: 'metadata@test.example', role: 'admin' })
  await db.insert(session).values({
    id: 'session',
    userId: 'admin',
    token: 'session-token',
    expiresAt: new Date(Date.now() + 60_000),
  })
  await db.run(sql`INSERT INTO music_artists(id,name,slug,createdAt,updatedAt)
    VALUES ('a','A','a',1,1),('b','B','b',1,1),('c','C','c',1,1)`)
  await db.run(sql`INSERT INTO music_albums(id,title,slug,artistNames,coverImageUrl,publishedAt,createdAt,updatedAt)
    VALUES ('x','Album','x','["A"]','https://example.test/album.png',123,1,1),('y','Other','y','[]',NULL,NULL,1,1)`)
  await db.run(
    sql`INSERT INTO music_album_artists(albumId,artistId,role,displayOrder) VALUES ('x','a','producer',3)`,
  )
  await db.run(sql`INSERT INTO music_tracks(id,title,slug,albumId,artistNames,coverImageUrl,publishedAt,createdAt,updatedAt)
    VALUES ('t','Track','t','x','["A"]','https://example.test/track.png',456,1,1)`)
  await db.run(
    sql`INSERT INTO music_track_artists(trackId,artistId,role,displayOrder) VALUES ('t','a','featured',0)`,
  )
  await db.run(sql`INSERT INTO music_labels(id,name,slug,description,content,image_url,published_at,created_at,updated_at)
    VALUES ('l','Label','l','Before','manual content','https://example.test/label.png',789,1,1)`)
  const web = createTestWebHandler(resource.database)

  const patch = (collection: string, id: string, payload: Schema.Json) =>
    web.handler(
      new Request(`http://localhost/api/music/${collection}/${id}`, {
        method: 'PATCH',
        headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    )

  const reference = (entityType: 'artist' | 'album', entityId: string) => ({
    entityType,
    entityId,
    expectedRevision: 0,
  })

  try {
    for (const [collection, id] of [
      ['albums', 'x'],
      ['tracks', 't'],
      ['labels', 'l'],
    ] as const)
      expect((await patch(collection, id, {})).status).toBe(428)

    const albumInput = {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      title: 'Renamed album',
      artistIds: ['b', 'a'],
      artistNames: ['B', 'A'],
      references: [reference('artist', 'a'), reference('artist', 'b')],
      genres: ['Jazz', 'Jazz', 'Ambient'],
      releaseDate: '2026-01-02T00:00:00.000Z',
    }

    const album = await patch('albums', 'x', albumInput)
    expect(album.status).toBe(200)
    const albumSaved = await album.json()
    expect(albumSaved).toMatchObject({
      title: 'Renamed album',
      artistNames: ['B', 'A'],
      revision: 1,
      genres: ['Jazz', 'Ambient'],
      coverImageUrl: 'https://example.test/album.png',
      publishedAt: new Date(123).toISOString(),
      releaseDate: '2026-01-02T00:00:00.000Z',
    })
    expect(
      await db.all(
        sql`SELECT artistId,role,displayOrder FROM music_album_artists WHERE albumId='x' ORDER BY displayOrder`,
      ),
    ).toEqual([
      { artistId: 'b', role: null, displayOrder: 0 },
      { artistId: 'a', role: 'producer', displayOrder: 1 },
    ])
    expect(
      (
        await patch('albums', 'x', {
          requestId: crypto.randomUUID(),
          expectedRevision: 1,
          artistNames: ['Lie'],
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await patch('albums', 'x', {
          requestId: crypto.randomUUID(),
          expectedRevision: 1,
          title: 'Later album',
        })
      ).status,
    ).toBe(200)
    const albumReplay = await patch('albums', 'x', albumInput)
    expect(albumReplay.status).toBe(200)
    expect(await albumReplay.json()).toEqual(albumSaved)

    const trackInput = {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      title: 'Renamed track',
      albumId: 'y',
      artistIds: ['c', 'a'],
      references: [reference('artist', 'a'), reference('artist', 'c'), reference('album', 'y')],
    }

    expect((await patch('tracks', 't', { ...trackInput, references: [] })).status).toBe(400)
    expect(
      (
        await patch('tracks', 't', {
          ...trackInput,
          references: [
            reference('artist', 'a'),
            reference('artist', 'c'),
            { ...reference('album', 'y'), expectedRevision: 1 },
          ],
        })
      ).status,
    ).toBe(409)
    const track = await patch('tracks', 't', trackInput)
    expect(track.status).toBe(200)
    const trackSaved = await track.json()
    expect(trackSaved).toMatchObject({
      title: 'Renamed track',
      albumId: 'y',
      artistNames: ['C', 'A'],
      revision: 1,
      coverImageUrl: 'https://example.test/track.png',
      publishedAt: new Date(456).toISOString(),
    })
    expect(
      await db.all(
        sql`SELECT artistId,role,displayOrder FROM music_track_artists WHERE trackId='t' ORDER BY displayOrder`,
      ),
    ).toEqual([
      { artistId: 'c', role: null, displayOrder: 0 },
      { artistId: 'a', role: 'featured', displayOrder: 1 },
    ])
    expect(
      (
        await patch('tracks', 't', {
          requestId: crypto.randomUUID(),
          expectedRevision: 1,
          albumId: null,
        })
      ).status,
    ).toBe(200)
    const trackReplay = await patch('tracks', 't', trackInput)
    expect(trackReplay.status).toBe(200)
    expect(await trackReplay.json()).toEqual(trackSaved)

    const labelInput = {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      description: 'After',
      tags: ['Manual', 'Manual'],
      genres: ['Jazz'],
    }

    const label = await patch('labels', 'l', labelInput)
    expect(label.status).toBe(200)
    const labelSaved = await label.json()
    expect(labelSaved).toMatchObject({
      description: 'After',
      revision: 1,
      content: 'manual content',
      tags: ['Manual'],
      genres: ['Jazz'],
      imageUrl: 'https://example.test/label.png',
      publishedAt: new Date(789).toISOString(),
    })
    expect(
      (
        await patch('labels', 'l', {
          requestId: crypto.randomUUID(),
          expectedRevision: 1,
          description: 'Later',
        })
      ).status,
    ).toBe(200)
    const labelReplay = await patch('labels', 'l', labelInput)
    expect(labelReplay.status).toBe(200)
    expect(await labelReplay.json()).toEqual(labelSaved)

    expect(
      (
        await patch('tracks', 't', {
          requestId: crypto.randomUUID(),
          expectedRevision: 2,
          artistIds: [],
          references: [reference('artist', 'c'), reference('artist', 'a')],
        })
      ).status,
    ).toBe(200)
    expect(await db.all(sql`SELECT artistId FROM music_track_artists WHERE trackId='t'`)).toEqual(
      [],
    )
    expect(await db.get(sql`SELECT artistNames,revision FROM music_tracks WHERE id='t'`)).toEqual({
      artistNames: '[]',
      revision: 3,
    })

    const config = createConfig()

    const authority = await Effect.runPromise(
      makeSessionCommandAuthority.pipe(
        Effect.provideService(AuthSession, {
          user: { id: 'admin', name: 'Admin', email: 'metadata@test.example' },
          session: { id: 'session', createdAt: new Date() },
        }),
        Effect.provideService(Database, db),
        Effect.provideService(ConfigService, config),
      ),
    )

    const executor = createMusicEditExecutor(authority.checkpoint)

    const [browserRace, mcpRace] = await Promise.all([
      patch('tracks', 't', {
        requestId: crypto.randomUUID(),
        expectedRevision: 3,
        coverImageUrl: 'https://example.test/new.png',
      }),
      Effect.runPromise(
        executor
          .apply(
            {
              requestId: crypto.randomUUID(),
              expectedRevision: 3,
              references: [],
              change: {
                operation: 'update_music_metadata',
                entityType: 'track',
                entityId: 't',
                metadata: { title: 'MCP race' },
              },
            },
            Date.now(),
          )
          .pipe(
            Effect.provideService(Database, db),
            Effect.provideService(McpOperationStore, createMcpOperationStore(resource.database)),
          ),
      ),
    ])

    expect(Number(browserRace.status === 200) + Number(mcpRace.status === 'applied')).toBe(1)
    expect(browserRace.status === 409 || mcpRace.status === 'conflict').toBe(true)
    expect(await db.get(sql`SELECT revision FROM music_tracks WHERE id='t'`)).toEqual({
      revision: 4,
    })

    await db.run(sql`UPDATE music_albums SET revision=${Number.MAX_SAFE_INTEGER} WHERE id='y'`)
    expect(
      (
        await patch('albums', 'y', {
          requestId: crypto.randomUUID(),
          expectedRevision: Number.MAX_SAFE_INTEGER,
          title: 'Other',
        })
      ).status,
    ).toBe(200)
    expect(
      await db.get(sql`SELECT revision,slug,updatedAt FROM music_albums WHERE id='y'`),
    ).toEqual({ revision: Number.MAX_SAFE_INTEGER, slug: 'y', updatedAt: 1 })
    expect(
      (
        await patch('albums', 'y', {
          requestId: crypto.randomUUID(),
          expectedRevision: Number.MAX_SAFE_INTEGER,
          title: 'Changed',
        })
      ).status,
    ).toBe(409)
  } finally {
    await web.dispose()
  }
}, 20_000)

test('all four session deletes enforce strict headers, atomically invalidate fanout and replay absent roots', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await seedMusicLookups(db)
  await db
    .insert(user)
    .values({ id: 'admin', name: 'Admin', email: 'deletes@test.example', role: 'admin' })
  await db.insert(session).values({
    id: 'session',
    userId: 'admin',
    token: 'session-token',
    expiresAt: new Date(Date.now() + 60_000),
  })
  await db.run(
    sql`INSERT INTO music_artists(id,name,slug,createdAt,updatedAt) VALUES ('a','A','a',1,1),('b','B','b',1,1)`,
  )
  await db.run(
    sql`INSERT INTO music_albums(id,title,slug,artistNames,createdAt,updatedAt) VALUES ('x','X','x','["A","B"]',1,1),('y','Y','y','["B"]',1,1)`,
  )
  await db.run(
    sql`INSERT INTO music_tracks(id,title,slug,artistNames,albumId,createdAt,updatedAt) VALUES ('t','T','t','["A","B"]','x',1,1),('u','U','u','["B"]','y',1,1)`,
  )
  await db.run(
    sql`INSERT INTO music_album_artists(albumId,artistId,displayOrder) VALUES ('x','a',0),('x','b',1),('y','b',0)`,
  )
  await db.run(
    sql`INSERT INTO music_track_artists(trackId,artistId,displayOrder) VALUES ('t','a',0),('t','b',1),('u','b',0)`,
  )
  await db.run(
    sql`INSERT INTO music_labels(id,name,slug,created_at,updated_at) VALUES ('l','L','l',1,1),('m','M','m',1,1)`,
  )
  await db.run(
    sql`INSERT INTO music_label_artists(label_id,artist_id) VALUES ('l','a'),('l','b'),('m','b')`,
  )
  await db.run(
    sql`INSERT INTO music_label_albums(label_id,album_id) VALUES ('l','x'),('l','y'),('m','y')`,
  )
  await db.run(
    sql`INSERT INTO music_playlists(id,title,slug,createdAt,updatedAt) VALUES ('p','P','p',1,1)`,
  )
  await db.run(
    sql`INSERT INTO music_playlist_tracks(playlistId,trackId,position,addedAt) VALUES ('p','t',0,1),('p','u',1,1)`,
  )
  await db.run(sql`INSERT INTO posts(id,slug,content,createdAt,updatedAt)
    VALUES ('post','post','Keep authored content',1,1)`)
  await db.run(sql`INSERT INTO post_music_references(post_id,position,album_id,track_id)
    VALUES ('post',0,'x',NULL),('post',1,NULL,'t')`)
  await db.run(sql`INSERT INTO releases(id,title,slug,content,labelId,createdAt,updatedAt)
    VALUES ('release','Release','release','Keep release content','l',1,1)`)
  await db.run(sql`INSERT INTO music_recording_credits
    (id,album_id,artist_id,credited_name,credited_name_key,role,instrument_key,participant_key,
      display_order,source_label,evidence_note,asserted_at,created_at)
    VALUES ('fact','x','a','A','a','producer','','artist:a',0,'Manual','Keep fact',1,1)`)
  const web = createTestWebHandler(resource.database)

  const remove = (collection: string, id: string, headers: Readonly<Record<string, string>>) =>
    web.handler(
      new Request(`http://localhost/api/music/${collection}/${id}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer session-token', ...headers },
      }),
    )

  try {
    for (const [collection, id, revision, unlink] of [
      ['artists', 'a', 0, sql`DELETE FROM music_recording_credits WHERE id='fact'`],
      ['albums', 'x', 1, sql`DELETE FROM post_music_references WHERE album_id='x'`],
      ['tracks', 't', 2, sql`DELETE FROM post_music_references WHERE track_id='t'`],
      ['labels', 'l', 2, sql`DELETE FROM releases WHERE id='release'`],
    ] as const) {
      const headers = {
        'x-gbfm-music-revision': String(revision),
        'x-gbfm-request-id': crypto.randomUUID(),
      }

      expect((await remove(collection, id, {})).status).toBe(428)
      expect(
        (await remove(collection, id, { ...headers, 'x-gbfm-music-revision': '01' })).status,
      ).toBe(400)
      expect(
        (
          await remove(collection, id, {
            ...headers,
            'x-gbfm-music-revision': String(revision + 1),
          })
        ).status,
      ).toBe(409)
      // Known protecting facts are conflicts, not retryable storage outages.
      // Removing just that fact permits the very same request and observation.
      expect((await remove(collection, id, headers)).status).toBe(409)
      expect((await remove(collection, id, headers)).status).toBe(409)
      expect(await db.get(sql`SELECT content FROM posts WHERE id='post'`)).toEqual({
        content: 'Keep authored content',
      })
      await db.run(unlink)
      expect((await remove(collection, id, headers)).status).toBe(204)
      expect((await remove(collection, id, headers)).status).toBe(204)
      expect(
        (await remove(collection, id, { ...headers, 'x-gbfm-request-id': crypto.randomUUID() }))
          .status,
      ).toBe(404)

      expect(await db.get(sql`SELECT artistNames,revision FROM music_albums WHERE id='x'`)).toEqual(
        collection === 'artists' ? { artistNames: '["B"]', revision: 1 } : undefined,
      )
      expect(
        await db.get(sql`SELECT artistNames,albumId,revision FROM music_tracks WHERE id='t'`),
      ).toEqual(
        {
          artists: { artistNames: '["B"]', albumId: 'x', revision: 1 },
          albums: { artistNames: '["B"]', albumId: null, revision: 2 },
          tracks: undefined,
          labels: undefined,
        }[collection],
      )
    }

    expect(await db.get(sql`SELECT revision FROM music_playlists WHERE id='p'`)).toEqual({
      revision: 1,
    })
    expect(
      await db.all(sql`SELECT trackId,position FROM music_playlist_tracks WHERE playlistId='p'`),
    ).toEqual([{ trackId: 'u', position: 1 }])
    expect(await db.get(sql`SELECT revision FROM music_artists WHERE id='b'`)).toEqual({
      revision: 1,
    })
    expect(await db.get(sql`SELECT revision FROM music_albums WHERE id='y'`)).toEqual({
      revision: 1,
    })
    expect(await db.get(sql`SELECT revision FROM music_labels WHERE id='m'`)).toEqual({
      revision: 0,
    })
    expect(await db.get(sql`SELECT revision FROM music_tracks WHERE id='u'`)).toEqual({
      revision: 0,
    })
    expect(await db.get(sql`SELECT count(*) AS total FROM mcp_operations`)).toEqual({ total: 4 })
  } finally {
    await web.dispose()
  }
}, 20_000)
