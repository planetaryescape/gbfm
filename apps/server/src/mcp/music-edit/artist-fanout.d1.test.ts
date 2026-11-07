import { type SQL, sql } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { expect, test } from 'vitest'

import { createMigratedD1Database } from '@/test/migrate-d1'

import { artistNameFanoutStatements } from './artist-fanout'

test('the production fanout helper fences stale attempts, projects ordered names and rolls back with its artist CAS', async () => {
  const resource = await createMigratedD1Database()
  const d1 = resource.database
  const dialect = new SQLiteSyncDialect()

  const prepare = (statement: SQL) => {
    const query = dialect.sqlToQuery(statement)

    return d1.prepare(query.sql).bind(...query.params)
  }

  try {
    // Disposable proof against the approved column shape until 0017 is in the
    // stack. Never adds tracked DDL or asserts existing writer compliance.
    for (const table of ['music_artists', 'music_albums', 'music_tracks']) {
      const columns = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()

      if (!columns.results.some((column) => column.name === 'revision')) {
        await d1
          .prepare(`ALTER TABLE ${table} ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`)
          .run()
        await d1.prepare(`ALTER TABLE ${table} ADD COLUMN last_operation_id TEXT`).run()
      }
    }

    await d1.batch([
      d1.prepare(`INSERT INTO music_artists (id,name,slug,createdAt,updatedAt) VALUES
        ('z','Zed','z',1,1),('a','Ada','a',1,1)`),
      d1.prepare(`INSERT INTO music_albums (id,title,slug,artistNames,createdAt,updatedAt) VALUES
        ('linked','Linked','linked','["outdated"]',1,1),('other','Other','other','["Ada"]',1,1)`),
      d1.prepare(`INSERT INTO music_tracks (id,title,slug,artistNames,createdAt,updatedAt) VALUES
        ('track','Track','track','["Zed"]',1,1)`),
      d1.prepare(`INSERT INTO music_album_artists (albumId,artistId,displayOrder) VALUES
        ('linked','z',7),('linked','a',7),('other','a',0)`),
      d1.prepare(
        `INSERT INTO music_track_artists (trackId,artistId,displayOrder) VALUES ('track','z',0)`,
      ),
    ])

    const rename = (attemptId: string, revision: number, name: string, fence = sql`1`) => [
      prepare(sql`UPDATE music_artists SET name=${name},revision=revision+1,
        last_operation_id=${attemptId} WHERE id='z' AND revision=${revision} AND ${fence}`),
      ...artistNameFanoutStatements({ prepare, artistId: 'z', attemptId, fence }),
    ]

    await d1.batch(rename('winner', 0, 'Renamed'))
    expect(
      await d1
        .prepare(
          `SELECT artistNames,revision,last_operation_id FROM music_albums WHERE id='linked'`,
        )
        .first(),
    ).toEqual({ artistNames: '["Ada","Renamed"]', revision: 1, last_operation_id: 'winner' })
    expect(
      await d1.prepare(`SELECT artistNames,revision FROM music_tracks WHERE id='track'`).first(),
    ).toEqual({ artistNames: '["Renamed"]', revision: 1 })
    expect(
      await d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='other'`).first(),
    ).toEqual({ artistNames: '["Ada"]', revision: 0 })

    await d1.batch(rename('loser', 0, 'Stale'))
    await d1.batch([
      ...artistNameFanoutStatements({ prepare, artistId: 'z', attemptId: 'winner', fence: sql`0` }),
    ])
    expect(
      await d1.prepare(`SELECT name,revision FROM music_artists WHERE id='z'`).first(),
    ).toEqual({ name: 'Renamed', revision: 1 })
    expect(await d1.prepare(`SELECT revision FROM music_albums WHERE id='linked'`).first()).toEqual(
      { revision: 1 },
    )

    await d1.prepare('CREATE TABLE m1_fanout_abort (n INTEGER CHECK(n=1))').run()
    await expect(
      d1.batch([
        ...rename('rollback', 1, 'Must roll back'),
        d1.prepare('INSERT INTO m1_fanout_abort VALUES (0)'),
      ]),
    ).rejects.toThrow()
    expect(
      await d1.prepare(`SELECT name,revision FROM music_artists WHERE id='z'`).first(),
    ).toEqual({ name: 'Renamed', revision: 1 })
    expect(
      await d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='linked'`).first(),
    ).toEqual({ artistNames: '["Ada","Renamed"]', revision: 1 })
  } finally {
    await resource.dispose()
  }
})
