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

    const winningAttempt = crypto.randomUUID()
    await d1.batch(rename(winningAttempt, 0, 'Renamed'))
    expect(
      await d1
        .prepare(
          `SELECT artistNames,revision,last_operation_id FROM music_albums WHERE id='linked'`,
        )
        .first(),
    ).toEqual({ artistNames: '["Ada","Renamed"]', revision: 1, last_operation_id: winningAttempt })
    expect(
      await d1.prepare(`SELECT artistNames,revision FROM music_tracks WHERE id='track'`).first(),
    ).toEqual({ artistNames: '["Renamed"]', revision: 1 })
    expect(
      await d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='other'`).first(),
    ).toEqual({ artistNames: '["Ada"]', revision: 0 })

    await d1.batch(rename(crypto.randomUUID(), 0, 'Stale'))
    await d1.batch([
      ...artistNameFanoutStatements({
        prepare,
        artistId: 'z',
        attemptId: winningAttempt,
        fence: sql`0`,
      }),
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
        ...rename(crypto.randomUUID(), 1, 'Must roll back'),
        d1.prepare('INSERT INTO m1_fanout_abort VALUES (0)'),
      ]),
    ).rejects.toThrow()
    expect(
      await d1.prepare(`SELECT name,revision FROM music_artists WHERE id='z'`).first(),
    ).toEqual({ name: 'Renamed', revision: 1 })
    expect(
      await d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='linked'`).first(),
    ).toEqual({ artistNames: '["Ada","Renamed"]', revision: 1 })
    // Even a caller missing the pre-CAS capacity predicate cannot overflow or
    // commit the earlier album projection when the later track is exhausted.
    await d1
      .prepare(`UPDATE music_tracks SET revision=? WHERE id='track'`)
      .bind(Number.MAX_SAFE_INTEGER)
      .run()
    await expect(d1.batch(rename(crypto.randomUUID(), 1, 'Must not commit'))).rejects.toThrow()
    expect(
      await d1.prepare(`SELECT name,revision FROM music_artists WHERE id='z'`).first(),
    ).toEqual({ name: 'Renamed', revision: 1 })
    expect(
      await d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='linked'`).first(),
    ).toEqual({ artistNames: '["Ada","Renamed"]', revision: 1 })
    expect(
      await d1.prepare(`SELECT artistNames,revision FROM music_tracks WHERE id='track'`).first(),
    ).toEqual({ artistNames: '["Renamed"]', revision: Number.MAX_SAFE_INTEGER })
  } finally {
    await resource.dispose()
  }
})
