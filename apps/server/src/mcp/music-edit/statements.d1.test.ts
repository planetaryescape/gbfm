import { type SQL, sql } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { Effect, Schema } from 'effect'
import { expect, test } from 'vitest'

import { Database, makeDatabaseClient } from '@/db/layer'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { MusicEditCommand } from './commands'
import { planMusicEdit } from './planner'
import { musicEditStatements } from './statements'

test('real domain statements keep exact credits, names, genres and both affiliation versions together', async () => {
  const resource = await createMigratedD1Database()
  const d1 = resource.database
  const db = makeDatabaseClient(d1)
  const dialect = new SQLiteSyncDialect()

  const prepare = (statement: SQL) => {
    const query = dialect.sqlToQuery(statement)

    return d1.prepare(query.sql).bind(...query.params)
  }

  const command = Schema.decodeUnknownSync(MusicEditCommand, { onExcessProperty: 'error' })

  const requestId = '2f1078f5-239b-4fc9-9022-d1126bd194d3'

  const apply = async (input: MusicEditCommand, token: string, artistNameChanged = false) => {
    const plan = await Effect.runPromise(
      planMusicEdit(input.change).pipe(Effect.provideService(Database, db)),
    )

    const batch = musicEditStatements({
      command: input,
      changed: plan.changed,
      artistNameChanged,
      now: 1000,
      attemptId: token,
      eligibility: sql`1`,
      fence: sql`1`,
      prepare,
    })

    await d1.batch(batch.statements)

    return prepare(sql`SELECT (${batch.assertApplied}) AS winner`).first<{ winner: number }>()
  }

  try {
    for (const table of ['music_artists', 'music_albums', 'music_tracks', 'music_labels']) {
      const columns = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()

      if (!columns.results.some((column) => column.name === 'revision')) {
        await d1
          .prepare(`ALTER TABLE ${table} ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`)
          .run()
        await d1.prepare(`ALTER TABLE ${table} ADD COLUMN last_operation_id TEXT`).run()
      }
    }

    await d1.batch([
      d1.prepare(
        `INSERT INTO music_artists (id,name,slug,createdAt,updatedAt) VALUES ('a','Ada','a',1,1),('z','Zed','z',1,1)`,
      ),
      d1.prepare(
        `INSERT INTO music_albums (id,title,slug,createdAt,updatedAt) VALUES ('x','X','x',1,1),('y','Y','y',1,1)`,
      ),
      d1.prepare(
        `INSERT INTO music_tracks (id,title,slug,createdAt,updatedAt) VALUES ('t','T','t',1,1)`,
      ),
      d1.prepare(
        `INSERT INTO music_labels (id,name,slug,created_at,updated_at) VALUES ('l','L','l',1,1)`,
      ),
      d1.prepare(
        `INSERT INTO music_album_artists (albumId,artistId,displayOrder) VALUES ('x','a',5),('x','z',7),('y','z',0)`,
      ),
      d1.prepare(
        `INSERT INTO labels(id,kind,name) VALUES ('tag','tag','Keep'),('genre','genre','Old')`,
      ),
      d1.prepare(
        `INSERT INTO entity_labels(entity_type,entity_id,position,label_id) VALUES ('album','x',0,'genre'),('album','x',1,'tag')`,
      ),
    ])

    expect(
      await apply(
        command({
          requestId,
          expectedRevision: 0,
          references: [],
          change: { operation: 'set_album_type', entityId: 'x', albumType: 'EP' },
        }),
        'type',
      ),
    ).toEqual({ winner: 1 })
    expect(
      await apply(
        command({
          requestId,
          expectedRevision: 0,
          references: [{ entityType: 'album', entityId: 'x', expectedRevision: 1 }],
          change: { operation: 'set_track_album', entityId: 't', albumId: 'x' },
        }),
        'album',
      ),
    ).toEqual({ winner: 1 })
    expect(
      await apply(
        command({
          requestId,
          expectedRevision: 1,
          references: [],
          change: {
            operation: 'set_music_genres',
            entityType: 'album',
            entityId: 'x',
            genres: ['Jazz', 'Soul'],
          },
        }),
        'genres',
      ),
    ).toEqual({ winner: 1 })
    expect(
      (
        await d1
          .prepare(
            `SELECT l.kind,l.name FROM entity_labels el JOIN labels l ON l.id=el.label_id WHERE el.entity_id='x' ORDER BY l.kind,el.position`,
          )
          .all()
      ).results,
    ).toEqual([
      { kind: 'genre', name: 'Jazz' },
      { kind: 'genre', name: 'Soul' },
      { kind: 'tag', name: 'Keep' },
    ])

    expect(
      await apply(
        command({
          requestId,
          expectedRevision: 2,
          references: [{ entityType: 'artist', entityId: 'z', expectedRevision: 0 }],
          change: {
            operation: 'set_artist_credit',
            entityType: 'album',
            entityId: 'x',
            artistId: 'z',
            role: 'featured',
            displayOrder: 1,
          },
        }),
        'credit',
      ),
    ).toEqual({ winner: 1 })
    expect(
      await d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='x'`).first(),
    ).toEqual({ artistNames: '["Zed","Ada"]', revision: 3 })
    expect(
      await apply(
        command({
          requestId,
          expectedRevision: 3,
          references: [{ entityType: 'artist', entityId: 'z', expectedRevision: 0 }],
          change: {
            operation: 'remove_artist_credit',
            entityType: 'album',
            entityId: 'x',
            artistId: 'z',
          },
        }),
        'remove',
      ),
    ).toEqual({ winner: 1 })
    expect(
      (
        await d1
          .prepare(`SELECT albumId,artistId FROM music_album_artists ORDER BY albumId,artistId`)
          .all()
      ).results,
    ).toEqual([
      { albumId: 'x', artistId: 'a' },
      { albumId: 'y', artistId: 'z' },
    ])
    expect(
      await d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='x'`).first(),
    ).toEqual({ artistNames: '["Ada"]', revision: 4 })

    for (const [operation, expectedRevision, labelRevision] of [
      ['set_label_affiliation', 4, 0],
      ['remove_label_affiliation', 5, 1],
    ] as const) {
      expect(
        await apply(
          command({
            requestId,
            expectedRevision,
            references: [{ entityType: 'label', entityId: 'l', expectedRevision: labelRevision }],
            change: { operation, entityType: 'album', entityId: 'x', labelId: 'l' },
          }),
          operation,
        ),
      ).toEqual({ winner: 1 })
    }

    expect(await d1.prepare(`SELECT revision FROM music_labels WHERE id='l'`).first()).toEqual({
      revision: 2,
    })
    expect((await d1.prepare('SELECT * FROM music_label_albums').all()).results).toEqual([])

    const stale = command({
      requestId,
      expectedRevision: 0,
      references: [],
      change: {
        operation: 'set_music_genres',
        entityType: 'album',
        entityId: 'x',
        genres: ['Must not create'],
      },
    })

    expect(await apply(stale, 'stale')).toEqual({ winner: 0 })
    expect(
      (await d1.prepare(`SELECT id FROM labels WHERE name='Must not create'`).all()).results,
    ).toEqual([])
    expect(await d1.prepare(`SELECT revision FROM music_albums WHERE id='x'`).first()).toEqual({
      revision: 6,
    })
    expect(
      await apply(
        command({
          requestId,
          expectedRevision: 1,
          references: [],
          change: {
            operation: 'update_music_metadata',
            entityType: 'track',
            entityId: 't',
            metadata: { title: 'New', trackNumber: 2 },
          },
        }),
        'metadata',
      ),
    ).toEqual({ winner: 1 })
    expect(
      await d1
        .prepare(`SELECT title,trackNumber,revision,albumId FROM music_tracks WHERE id='t'`)
        .first(),
    ).toEqual({ title: 'New', trackNumber: 2, revision: 2, albumId: 'x' })

    await d1
      .prepare(`UPDATE music_albums SET revision=?,albumType='LP' WHERE id='x'`)
      .bind(Number.MAX_SAFE_INTEGER - 1)
      .run()

    const typeChange = {
      requestId,
      references: [],
      change: { operation: 'set_album_type', entityId: 'x', albumType: 'EP' },
    }

    expect(
      await apply(
        command({ ...typeChange, expectedRevision: Number.MAX_SAFE_INTEGER - 1 }),
        'last-capacity',
      ),
    ).toEqual({ winner: 1 })
    expect(
      await d1.prepare(`SELECT revision,albumType FROM music_albums WHERE id='x'`).first(),
    ).toEqual({ revision: Number.MAX_SAFE_INTEGER, albumType: 'EP' })
    expect(
      await apply(
        command({
          ...typeChange,
          expectedRevision: Number.MAX_SAFE_INTEGER,
          change: { ...typeChange.change, albumType: 'LP' },
        }),
        'overflow',
      ),
    ).toEqual({ winner: 0 })
    expect(
      await d1.prepare(`SELECT revision,albumType FROM music_albums WHERE id='x'`).first(),
    ).toEqual({ revision: Number.MAX_SAFE_INTEGER, albumType: 'EP' })
    expect(
      await apply(
        command({ ...typeChange, expectedRevision: Number.MAX_SAFE_INTEGER }),
        'capacity-noop',
      ),
    ).toEqual({ winner: 1 })

    await d1
      .prepare(`UPDATE music_labels SET revision=? WHERE id='l'`)
      .bind(Number.MAX_SAFE_INTEGER)
      .run()
    expect(
      await apply(
        command({
          requestId,
          expectedRevision: 0,
          references: [
            { entityType: 'label', entityId: 'l', expectedRevision: Number.MAX_SAFE_INTEGER },
          ],
          change: {
            operation: 'set_label_affiliation',
            entityType: 'album',
            entityId: 'y',
            labelId: 'l',
          },
        }),
        'label-overflow',
      ),
    ).toEqual({ winner: 0 })
    expect(await d1.prepare(`SELECT revision FROM music_albums WHERE id='y'`).first()).toEqual({
      revision: 0,
    })
    expect((await d1.prepare(`SELECT * FROM music_label_albums`).all()).results).toEqual([])

    // One exhausted linked album must prevent the artist rename and every other
    // parent projection, not just skip that album and commit a partial fanout.
    await d1
      .prepare(`UPDATE music_albums SET revision=? WHERE id='y'`)
      .bind(Number.MAX_SAFE_INTEGER)
      .run()
    expect(
      await apply(
        command({
          requestId,
          expectedRevision: 0,
          references: [],
          change: {
            operation: 'update_music_metadata',
            entityType: 'artist',
            entityId: 'z',
            metadata: { name: 'Do not rename' },
          },
        }),
        'fanout-overflow',
        true,
      ),
    ).toEqual({ winner: 0 })
    expect(
      await d1.prepare(`SELECT name,revision FROM music_artists WHERE id='z'`).first(),
    ).toEqual({ name: 'Zed', revision: 0 })
  } finally {
    await resource.dispose()
  }
})
