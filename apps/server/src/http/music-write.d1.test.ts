import { AuthSession } from '@gbfm/api/middleware/auth'
import { sql } from 'drizzle-orm'
import { Effect, Layer, type Schema } from 'effect'
import { expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import { Database, makeDatabaseClient } from '@/db/layer'
import { makeSessionCommandAuthority } from '@/mcp/command-authority'
import { createMusicEditExecutor } from '@/mcp/music-edit/executor'
import { McpOperationStore, createMcpOperationStore } from '@/mcp/operations/store'
import { ConfigService, createConfig } from '@/services/config.service'
import { createTestWebHandler } from '@/test/http-handler'
import { createMigratedD1Database } from '@/test/migrate-d1'

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
