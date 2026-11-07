import { expect, test } from 'vitest'

import { createMigratedD1Database } from '@/test/migrate-d1'

// Disposable feasibility probe ONLY. This is not a migration, production writer,
// or a second lane ledger. P1 must consolidate and approve the real storage seam.
test('candidate D1 batch keeps receipt, credit, artistNames and revision atomic', async () => {
  const resource = await createMigratedD1Database()
  const d1 = resource.database

  try {
    for (const sql of [
      'ALTER TABLE music_albums ADD COLUMN revision INTEGER NOT NULL DEFAULT 0',
      `CREATE TABLE m1_probe_receipts (
        actor TEXT NOT NULL, client TEXT NOT NULL, resource TEXT NOT NULL,
        operation TEXT NOT NULL, request_key TEXT NOT NULL, input_hash TEXT NOT NULL,
        commit_token TEXT NOT NULL, result TEXT, expires_at INTEGER NOT NULL,
        PRIMARY KEY(actor, client, resource, operation, request_key))`,
      `INSERT INTO music_artists (id,name,slug,createdAt,updatedAt)
       VALUES ('artist-a','Zed','zed',1,1),('artist-b','Ada','ada',1,1)`,
      `INSERT INTO music_albums (id,title,slug,createdAt,updatedAt,artistNames)
       VALUES ('album','Album','album',1,1,'[]')`,
      `CREATE TRIGGER m1_probe_credit_insert AFTER INSERT ON music_album_artists BEGIN
        UPDATE music_albums SET revision = revision + 1,
          artistNames = (SELECT json_group_array(name) FROM (
            SELECT a.name FROM music_album_artists j
            JOIN music_artists a ON a.id = j.artistId
            WHERE j.albumId = NEW.albumId ORDER BY j.displayOrder, j.artistId))
        WHERE id = NEW.albumId;
       END`,
    ])
      await d1.prepare(sql).run()

    const apply = (key: string, token: string, revision: number, artist: string, hash = artist) =>
      d1.batch([
        d1
          .prepare(`INSERT INTO m1_probe_receipts
          (actor,client,resource,operation,request_key,input_hash,commit_token,expires_at)
          SELECT 'admin','client','https://example.test/mcp','set_artist_credit',?,?,?,86400000
          FROM music_albums WHERE id='album' AND revision=?
          ON CONFLICT DO NOTHING`)
          .bind(key, hash, token, revision),
        d1
          .prepare(`INSERT INTO music_album_artists (albumId,artistId,displayOrder)
          SELECT 'album',?,1 FROM m1_probe_receipts WHERE commit_token=?`)
          .bind(artist, token),
        d1
          .prepare(`UPDATE m1_probe_receipts SET result=(
          SELECT json_object('revision',revision,'artistNames',json(artistNames))
          FROM music_albums WHERE id='album') WHERE commit_token=?`)
          .bind(token),
      ])

    // Browser and MCP observed revision zero. Whichever wins invalidates the other.
    await d1
      .prepare(`UPDATE music_albums SET title='Browser', revision=revision+1
      WHERE id='album' AND revision=0`)
      .run()
    await apply('stale', 'stale-token', 0, 'artist-a')
    expect((await d1.prepare('SELECT * FROM m1_probe_receipts').all()).results).toEqual([])
    expect((await d1.prepare('SELECT * FROM music_album_artists').all()).results).toEqual([])

    await Promise.all([
      apply('once', 'attempt-a', 1, 'artist-a'),
      apply('once', 'attempt-b', 1, 'artist-a'),
    ])
    const saved = await d1.prepare('SELECT * FROM m1_probe_receipts').all()
    expect(saved.results).toHaveLength(1)
    expect(saved.results[0]).toMatchObject({
      input_hash: 'artist-a',
      result: '{"revision":2,"artistNames":["Zed"]}',
    })
    expect(await d1.prepare('SELECT revision,artistNames FROM music_albums').first()).toEqual({
      revision: 2,
      artistNames: '["Zed"]',
    })

    const staleBrowser = await d1
      .prepare(`UPDATE music_albums SET title='Lost',revision=revision+1
      WHERE id='album' AND revision=1`)
      .run()

    expect(staleBrowser.meta.changes).toBe(0)

    // Same key cannot reapply, even with current revision or changed payload.
    // The service must compare input_hash and return conflict before replay.
    await apply('once', 'attempt-c', 2, 'artist-b')
    expect((await d1.prepare('SELECT * FROM music_album_artists').all()).results).toHaveLength(1)
    expect((await d1.prepare('SELECT * FROM m1_probe_receipts').all()).results).toEqual(
      saved.results,
    )

    // A failed FK after receipt acquisition rolls back the entire D1 batch.
    await expect(apply('bad', 'bad-token', 2, 'missing-artist')).rejects.toThrow()
    expect((await d1.prepare('SELECT * FROM m1_probe_receipts').all()).results).toEqual(
      saved.results,
    )
    expect(await d1.prepare('SELECT revision,artistNames FROM music_albums').first()).toEqual({
      revision: 2,
      artistNames: '["Zed"]',
    })

    await d1
      .prepare(`CREATE TRIGGER m1_probe_receipt_failure BEFORE UPDATE ON m1_probe_receipts
      WHEN NEW.commit_token='late-failure'
      BEGIN SELECT RAISE(ABORT, 'fixture failure after credit projection'); END`)
      .run()
    await expect(apply('late', 'late-failure', 2, 'artist-b')).rejects.toThrow()
    expect((await d1.prepare('SELECT * FROM m1_probe_receipts').all()).results).toEqual(
      saved.results,
    )
    expect(await d1.prepare('SELECT revision,artistNames FROM music_albums').first()).toEqual({
      revision: 2,
      artistNames: '["Zed"]',
    })
    expect((await d1.prepare('SELECT * FROM music_album_artists').all()).results).toHaveLength(1)

    // Retain the key/hash after result expiry, so pruning cannot resurrect a write.
    await d1
      .prepare('UPDATE m1_probe_receipts SET result=NULL WHERE expires_at <= ?')
      .bind(86400000)
      .run()
    await apply('once', 'attempt-expired', 2, 'artist-b')
    expect((await d1.prepare('SELECT * FROM m1_probe_receipts').all()).results).toHaveLength(1)
    expect((await d1.prepare('SELECT * FROM music_album_artists').all()).results).toHaveLength(1)
    expect(await d1.prepare('SELECT result FROM m1_probe_receipts').first()).toEqual({
      result: null,
    })
  } finally {
    await resource.dispose()
  }
})
