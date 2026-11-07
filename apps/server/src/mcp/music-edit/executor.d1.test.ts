import type { McpScope } from '@gbfm/core/editorial-mcp'
import { sql } from 'drizzle-orm'
import { Effect, Result, type Schema } from 'effect'
import { expect, test } from 'vitest'

import { Database, makeDatabaseClient } from '@/db/layer'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { McpToolError } from '../contracts'
import { McpOperationStore, createMcpOperationStore } from '../operations/store'
import type { MusicEditChange, MusicEditCommand } from './commands'
import { createMusicEditExecutor } from './executor'

const now = 1_800_000_000_000

const fixture = async () => {
  const resource = await createMigratedD1Database()
  const d1 = resource.database
  await d1.batch([
    d1.prepare(`INSERT INTO user(id,name,email,created_at,updated_at,role,banned)
      VALUES ('admin','Admin','m1@example.test',1,1,'admin',0)`),
    d1.prepare(`INSERT INTO oauth_client(id,client_id,redirect_uris,disabled)
      VALUES ('client-row','client','[]',0)`),
    // An explicit injectable policy fixture, NOT P1's production OAuth/session/PAT
    // provider. These tests prove the domain enforces a supplied live predicate.
    d1.prepare('CREATE TABLE m1_fixture_grant (enabled INTEGER NOT NULL)'),
    d1.prepare('INSERT INTO m1_fixture_grant VALUES (1)'),
    d1.prepare(`INSERT INTO music_artists(id,name,slug,createdAt,updatedAt)
      VALUES ('a','Ada','ada',1,1),('z','Zed','zed',1,1)`),
    d1.prepare(`INSERT INTO music_albums(id,title,slug,artistNames,createdAt,updatedAt)
      VALUES ('x','X','x','["Ada"]',1,1),('y','Y','y','["Zed"]',1,1)`),
    d1.prepare(`INSERT INTO music_tracks(id,title,slug,artistNames,createdAt,updatedAt)
      VALUES ('t','T','t','["Zed"]',1,1)`),
    d1.prepare(`INSERT INTO music_album_artists(albumId,artistId,displayOrder)
      VALUES ('x','a',0),('y','z',0)`),
    d1.prepare(`INSERT INTO music_track_artists(trackId,artistId,displayOrder) VALUES ('t','z',0)`),
    d1.prepare(
      `INSERT INTO music_labels(id,name,slug,created_at,updated_at) VALUES ('l','Label','label',1,1)`,
    ),
    d1.prepare(`INSERT INTO labels(id,kind,name) VALUES ('tag','tag','Keep')`),
    d1.prepare(
      `INSERT INTO entity_labels(entity_type,entity_id,label_id,position) VALUES ('album','x','tag',0)`,
    ),
    d1.prepare(`INSERT INTO music_artist_aliases(id,artist_id,name,name_key,source_label,evidence_note,asserted_at,created_at)
      VALUES ('alias','z','Stage','stage','Manual','Evidence',1,1)`),
  ])
  const liveGuard = sql`EXISTS (SELECT 1 FROM m1_fixture_grant WHERE enabled=1)`

  const checkpoint = (scopes: ReadonlyArray<McpScope>) =>
    Effect.gen(function* () {
      const enabled = yield* Effect.promise(() =>
        d1.prepare('SELECT enabled FROM m1_fixture_grant').first<{ enabled: number }>(),
      )

      if (scopes.length !== 1 || scopes[0] !== 'catalogue:write' || enabled?.enabled !== 1)
        return yield* new McpToolError({
          code: 'access_denied',
          message: 'Fixture authority denied.',
        })

      return {
        actorId: 'admin',
        clientId: 'client',
        resource: 'https://m1.example.test/mcp',
        liveGuard,
      }
    })

  const executor = createMusicEditExecutor(checkpoint)

  const applyEffect = (command: Schema.Json, at = now) =>
    executor
      .apply(command, at)
      .pipe(
        Effect.provideService(Database, makeDatabaseClient(d1)),
        Effect.provideService(McpOperationStore, createMcpOperationStore(d1)),
      )

  return {
    d1,
    dispose: resource.dispose,
    applyEffect,
    apply: (command: Schema.Json, at = now) => Effect.runPromise(applyEffect(command, at)),
  }
}

test('all eight real common-store writes preserve projections, alias facts and original replay results', async () => {
  const f = await fixture()

  const command = (
    expectedRevision: number,
    change: MusicEditChange,
    references: MusicEditCommand['references'] = [],
  ) => ({
    requestId: crypto.randomUUID(),
    expectedRevision,
    change,
    references,
  })

  try {
    expect(
      (await f.apply(command(0, { operation: 'set_album_type', entityId: 'x', albumType: 'EP' })))
        .status,
    ).toBe('applied')
    expect(
      (
        await f.apply(
          command(0, { operation: 'set_track_album', entityId: 't', albumId: 'x' }, [
            { entityType: 'album', entityId: 'x', expectedRevision: 1 },
          ]),
        )
      ).status,
    ).toBe('applied')

    const credit = command(
      1,
      {
        operation: 'set_artist_credit',
        entityType: 'album',
        entityId: 'x',
        artistId: 'z',
        role: 'featured',
        displayOrder: 2,
      },
      [{ entityType: 'artist', entityId: 'z', expectedRevision: 0 }],
    )

    const original = await f.apply(credit)
    expect(original.status).toBe('applied')
    expect(
      await f.d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='x'`).first(),
    ).toEqual({ artistNames: '["Ada","Zed"]', revision: 2 })
    expect(
      (
        await f.apply(
          command(
            2,
            {
              operation: 'remove_artist_credit',
              entityType: 'album',
              entityId: 'x',
              artistId: 'z',
            },
            credit.references,
          ),
        )
      ).status,
    ).toBe('applied')
    expect(
      (
        await f.apply(
          command(
            3,
            {
              operation: 'set_label_affiliation',
              entityType: 'album',
              entityId: 'x',
              labelId: 'l',
            },
            [{ entityType: 'label', entityId: 'l', expectedRevision: 0 }],
          ),
        )
      ).status,
    ).toBe('applied')
    expect(
      (
        await f.apply(
          command(
            4,
            {
              operation: 'remove_label_affiliation',
              entityType: 'album',
              entityId: 'x',
              labelId: 'l',
            },
            [{ entityType: 'label', entityId: 'l', expectedRevision: 1 }],
          ),
        )
      ).status,
    ).toBe('applied')
    expect(
      (
        await f.apply(
          command(5, {
            operation: 'set_music_genres',
            entityType: 'album',
            entityId: 'x',
            genres: ['Jazz', 'Soul'],
          }),
        )
      ).status,
    ).toBe('applied')
    expect(
      (
        await f.apply(
          command(6, {
            operation: 'update_music_metadata',
            entityType: 'album',
            entityId: 'x',
            metadata: { title: 'Edited' },
          }),
        )
      ).status,
    ).toBe('applied')
    expect(
      await f.d1
        .prepare(`SELECT title,artistNames,revision FROM music_albums WHERE id='x'`)
        .first(),
    ).toEqual({ title: 'Edited', artistNames: '["Ada"]', revision: 7 })
    expect(
      (
        await f.d1
          .prepare(
            `SELECT l.kind,l.name FROM entity_labels e JOIN labels l ON l.id=e.label_id WHERE e.entity_id='x' ORDER BY l.kind,e.position`,
          )
          .all()
      ).results,
    ).toEqual([
      { kind: 'genre', name: 'Jazz' },
      { kind: 'genre', name: 'Soul' },
      { kind: 'tag', name: 'Keep' },
    ])
    expect(await f.d1.prepare(`SELECT revision FROM music_labels WHERE id='l'`).first()).toEqual({
      revision: 2,
    })

    const rename = (name: string) =>
      command(0, {
        operation: 'update_music_metadata',
        entityType: 'artist',
        entityId: 'z',
        metadata: { name },
      })

    const invalid = await Effect.runPromise(Effect.result(f.applyEffect(rename('  STAGE  '))))

    if (Result.isSuccess(invalid)) throw new Error('Expected invalid_input')
    expect(invalid.failure.code).toBe('invalid_input')
    expect((await f.apply(rename('STAGE'))).status).toBe('conflict')
    expect((await f.apply(rename('Renamed'))).status).toBe('applied')
    expect(
      await f.d1.prepare(`SELECT artistNames,revision FROM music_albums WHERE id='y'`).first(),
    ).toEqual({ artistNames: '["Renamed"]', revision: 1 })
    expect(
      await f.d1
        .prepare(`SELECT artistNames,revision,albumId FROM music_tracks WHERE id='t'`)
        .first(),
    ).toEqual({ artistNames: '["Renamed"]', revision: 2, albumId: 'x' })
    expect(
      (await f.d1.prepare(`SELECT name,name_key FROM music_artist_aliases`).all()).results,
    ).toEqual([{ name: 'Stage', name_key: 'stage' }])
    expect(await f.apply(credit)).toEqual({ ...original, status: 'replayed' })
    expect((await f.apply({ ...credit, expectedRevision: 7 })).status).toBe('conflict')
    // Raw fixture deletion simulates a later reference removal, not a claim about
    // browser writer compliance. The earlier saved result must still replay.
    await f.d1.prepare(`DELETE FROM music_artists WHERE id='z'`).run()
    expect(await f.apply(credit)).toEqual({ ...original, status: 'replayed' })

    const missing = await Effect.runPromise(
      Effect.result(f.applyEffect({ ...credit, requestId: crypto.randomUUID() })),
    )

    if (Result.isSuccess(missing)) throw new Error('Expected not_found')
    expect(missing.failure.code).toBe('not_found')
    expect((await f.apply(credit, now + 86_400_000)).status).toBe('expired')
    expect(
      (await f.d1.prepare(`SELECT outcome FROM mcp_operations WHERE state='expired'`).all())
        .results,
    ).toEqual([{ outcome: null }])
  } finally {
    await f.dispose()
  }
})

test('a terminal safe revision rejects changes atomically but still receipts an exact no-op', async () => {
  const f = await fixture()

  try {
    await f.d1
      .prepare(`UPDATE music_albums SET revision=? WHERE id='x'`)
      .bind(Number.MAX_SAFE_INTEGER)
      .run()

    const command = {
      requestId: crypto.randomUUID(),
      expectedRevision: Number.MAX_SAFE_INTEGER,
      references: [],
      change: {
        operation: 'update_music_metadata',
        entityType: 'album',
        entityId: 'x',
        metadata: { title: 'Y' },
      },
    }

    expect((await f.apply(command)).status).toBe('conflict')
    expect((await f.d1.prepare('SELECT * FROM mcp_operations').all()).results).toEqual([])

    const noop = {
      ...command,
      requestId: crypto.randomUUID(),
      change: { ...command.change, metadata: { title: 'X' } },
    }

    const result = await f.apply(noop)
    expect(result).toMatchObject({
      status: 'applied',
      outcome: {
        result: { changed: false, after: { title: 'X' } },
        revision: { revision: Number.MAX_SAFE_INTEGER },
      },
    })
    expect(
      await f.d1.prepare(`SELECT title,revision FROM music_albums WHERE id='x'`).first(),
    ).toEqual({ title: 'X', revision: Number.MAX_SAFE_INTEGER })
    expect(await f.apply(noop)).toEqual({ ...result, status: 'replayed' })
  } finally {
    await f.dispose()
  }
})

test('stale intents and live SQL revocation roll back the root, junction, projection and receipt together', async () => {
  const f = await fixture()

  const command = {
    requestId: crypto.randomUUID(),
    expectedRevision: 0,
    references: [{ entityType: 'artist', entityId: 'z', expectedRevision: 0 }],
    change: {
      operation: 'set_artist_credit',
      entityType: 'album',
      entityId: 'x',
      artistId: 'z',
      role: null,
      displayOrder: 1,
    },
  }

  try {
    // Revocation occurs after the root CAS but before coupled DML/finalization;
    // the final assertion must reject the now-false liveGuard and roll back ALL.
    await f.d1
      .prepare(`CREATE TRIGGER m1_revoke_after_root AFTER UPDATE OF last_operation_id ON music_albums
      BEGIN UPDATE m1_fixture_grant SET enabled=0; END`)
      .run()
    expect((await f.apply(command)).status).toBe('conflict')
    expect(
      await f.d1
        .prepare(`SELECT revision,artistNames,last_operation_id FROM music_albums WHERE id='x'`)
        .first(),
    ).toEqual({ revision: 0, artistNames: '["Ada"]', last_operation_id: null })
    expect((await f.d1.prepare(`SELECT * FROM mcp_operations`).all()).results).toEqual([])
    expect(
      (await f.d1.prepare(`SELECT artistId FROM music_album_artists WHERE albumId='x'`).all())
        .results,
    ).toEqual([{ artistId: 'a' }])
    await f.d1.prepare('DROP TRIGGER m1_revoke_after_root').run()

    const contenders = await Promise.all([
      f.apply(command),
      f.apply({ ...command, requestId: crypto.randomUUID() }),
    ])

    expect(contenders.map((result) => result.status).sort()).toEqual(['applied', 'conflict'])
    expect(
      await f.d1.prepare(`SELECT revision,artistNames FROM music_albums WHERE id='x'`).first(),
    ).toEqual({ revision: 1, artistNames: '["Ada","Zed"]' })
    expect((await f.apply(command)).status).toBe(
      contenders[0]?.status === 'applied' ? 'replayed' : 'conflict',
    )
    await f.d1.prepare(`UPDATE m1_fixture_grant SET enabled=0`).run()
    const denied = await Effect.runPromise(Effect.result(f.applyEffect(command)))

    if (Result.isSuccess(denied)) throw new Error('Expected access_denied')
    expect(denied.failure.code).toBe('access_denied')
  } finally {
    await f.dispose()
  }
})
