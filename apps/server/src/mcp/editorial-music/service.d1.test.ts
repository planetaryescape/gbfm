import { McpPrincipal, PostId } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { DraftMusicTarget } from '@gbfm/core/post-music-references'
import { eq, sql } from 'drizzle-orm'
import { Clock, Effect, Layer, Schema } from 'effect'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { editorialOperations } from '@/db/editorial-operation.schema'
import { guardedPostUpdate } from '@/db/guarded-post-update'
import { Database, makeDatabaseClient } from '@/db/layer'
import { musicPlaylistsTable, musicTracksTable } from '@/db/music-entity.schema'
import { postMusicReferencesTable } from '@/db/post-music-reference.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'
import { ValidationError } from '@/errors'
import { withTestLayer } from '@/test/effect'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { McpActor } from '../authorization'
import { CommandAuthority } from '../command-authority'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings, projectPost } from '../model'
import { makeMcpWireResponse, McpWireResponse } from '../wire-response'
import { DraftReferenceDisplay } from './contracts'
import { saveEditorialChange } from './save'
import { EditorialMusicService, EditorialMusicServiceLayer } from './service'
import { loadEditorialSnapshot, loadReadableEditorialSnapshot } from './snapshot'
import { draftMusicTargetsGuard } from './targets'

const config = Schema.decodeUnknownSync(EditorialMcpSettings)({
  readScope: 'posts:read',
  environment: 'test',
  resourceUrl: 'https://api.example.test/mcp',
  frontendUrl: 'https://example.test',
})

const ownerId = Schema.decodeUnknownSync(UserId)('owner')

const principal = Schema.decodeUnknownSync(McpPrincipal)({
  userId: ownerId,
  clientId: 'fixture-client',
  scopes: ['posts:read', 'drafts:write', 'catalogue:read'],
})

const harness = async () => {
  const resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  await db.insert(user).values([
    { id: ownerId, name: 'Owner', email: 'owner@example.test', role: 'creator' },
    { id: 'other', name: 'Other', email: 'other@example.test', role: 'admin' },
  ])
  const postId = Schema.decodeUnknownSync(PostId)(crypto.randomUUID())
  await db.insert(postsTable).values({
    id: postId,
    slug: postId,
    type: 'post',
    title: 'Original',
    content: 'Saved source.  \n',
    draft: true,
  })
  await db.insert(postCreators).values({ postId, creatorId: ownerId })
  const track = DraftMusicTarget.make({ entityType: 'track', entityId: crypto.randomUUID() })
  const playlist = DraftMusicTarget.make({ entityType: 'playlist', entityId: crypto.randomUUID() })
  await db
    .insert(musicTracksTable)
    .values({ id: track.entityId, title: 'Track', slug: track.entityId })
  await db.insert(musicPlaylistsTable).values({
    id: playlist.entityId,
    title: 'Playlist',
    slug: playlist.entityId,
    publishedAt: new Date(0),
  })

  const run = <A, E>(effect: Effect.Effect<A, E, EditorialMusicService>, actor = principal) =>
    Effect.runPromise(
      withTestLayer(
        effect,
        EditorialMusicServiceLayer.pipe(
          Layer.provide(Layer.succeed(Database, db)),
          Layer.provide(Layer.succeed(EditorialMcpConfig, config)),
        ),
      ).pipe(
        Effect.provideService(McpActor, actor),
        Effect.provideService(McpWireResponse, makeMcpWireResponse(1, 'json')),
        // Domain tests deliberately use an explicit predicate, not persisted credential proof.
        Effect.provideService(
          CommandAuthority,
          CommandAuthority.of({
            checkpoint: () =>
              Effect.succeed({
                actorId: actor.userId,
                clientId: actor.clientId,
                resource: config.resourceUrl,
                liveGuard: sql`EXISTS (SELECT 1 FROM user WHERE id = ${actor.userId} AND coalesce(banned, 0) = 0)`,
              }),
          }),
        ),
      ),
    )

  const snapshot = () => Effect.runPromise(loadEditorialSnapshot(db, postId))
  const version = async () => Effect.runPromise(projectPost(await snapshot(), config))

  const state = async () => ({
    posts: await db.select().from(postsTable),
    refs: await db.select().from(postMusicReferencesTable),
    labels: await db.select().from(labelsTable),
    tags: await db.select().from(entityLabelsTable),
    receipts: await db.select().from(editorialOperations),
    creators: await db.select().from(postCreators),
  })

  const mutation = async () => ({
    postId,
    expectedVersion: (await version()).version,
    requestId: crypto.randomUUID(),
  })

  return {
    db,
    postId,
    track,
    playlist,
    run,
    snapshot,
    version,
    state,
    mutation,
    [Symbol.asyncDispose]: () => resource.dispose(),
  }
}

test('attach/detach preserve authored content, ordered secondary references and explicit primary; retries preserve original display', async () => {
  await using h = await harness()
  const input = { ...(await h.mutation()), target: h.playlist, position: 0, primary: true }
  const first = await h.run(Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(input)))
  expect(first.post.musicReferences).toMatchObject({
    references: [h.playlist],
    primary: h.playlist,
    display: [{ title: 'Playlist' }],
  })
  const attach = { ...(await h.mutation()), target: h.track, position: 0, primary: false }
  const second = await h.run(Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(attach)))
  expect(second.post.musicReferences.references).toEqual([h.track, h.playlist])
  expect(second.post.musicReferences.primary).toEqual(h.playlist)
  expect(second.post.content).toBe('Saved source.  \n')
  await h.db
    .update(musicPlaylistsTable)
    .set({ title: 'New title' })
    .where(eq(musicPlaylistsTable.id, h.playlist.entityId))
  expect(await h.run(Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(input)))).toEqual(
    first,
  )
  await h.db
    .update(musicPlaylistsTable)
    .set({ publishedAt: null })
    .where(eq(musicPlaylistsTable.id, h.playlist.entityId))
  const masked = await h.run(Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(input)))
  expect(masked.post.musicReferences.display).toEqual([
    DraftReferenceDisplay.cases.Unavailable.make({ target: h.playlist }),
  ])
  const detach = { ...(await h.mutation()), target: h.playlist, primary: null }
  const removed = await h.run(Effect.flatMap(EditorialMusicService, (s) => s.detachMusic(detach)))
  expect(removed.post.musicReferences.references).toEqual([h.track])
  expect(removed.post.musicReferences.primary).toBeNull()
  expect((await h.snapshot()).musicReferencesManaged).toBe(true)
})

test('stale browser and MCP writes share one version; tag-only writes and legacy primary edits preserve secondary references', async () => {
  await using h = await harness()
  const attach = { ...(await h.mutation()), target: h.track, position: 0, primary: true }
  await h.run(Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(attach)))
  const stale = await h.mutation()
  const [post] = await h.db.select().from(postsTable).where(eq(postsTable.id, h.postId))

  if (!post) throw new Error('Missing fixture')
  expect(await guardedPostUpdate(h.db, post, ownerId, {}, ['browser-tag'], [])).toHaveLength(1)
  await expect(
    h.run(
      Effect.flatMap(EditorialMusicService, (s) => s.setDraftTags({ ...stale, tags: ['stale'] })),
    ),
  ).rejects.toMatchObject({ code: 'conflict' })
  const tagging = { ...(await h.mutation()), tags: ['mcp-tag'] }
  const tags = await h.run(Effect.flatMap(EditorialMusicService, (s) => s.setDraftTags(tagging)))
  expect(tags.post.tags).toEqual(['mcp-tag'])
  expect(
    await guardedPostUpdate(h.db, post, ownerId, { title: 'Stale browser' }, ['stale'], []),
  ).toEqual([])
  const [current] = await h.db.select().from(postsTable).where(eq(postsTable.id, h.postId))

  if (!current) throw new Error('Missing fixture')
  await guardedPostUpdate(
    h.db,
    current,
    ownerId,
    { musicEntityType: 'playlist', musicEntityId: h.playlist.entityId },
    undefined,
    [],
  )
  expect((await h.snapshot()).musicReferences).toEqual({
    references: [h.track, h.playlist],
    primary: h.playlist,
  })
  const [selected] = await h.db.select().from(postsTable).where(eq(postsTable.id, h.postId))

  if (!selected) throw new Error('Missing fixture')
  await guardedPostUpdate(
    h.db,
    selected,
    ownerId,
    { musicEntityType: null, musicEntityId: null },
    undefined,
    [],
  )
  expect((await h.snapshot()).musicReferences).toEqual({
    references: [h.track, h.playlist],
    primary: null,
  })
})

test.each(['content', 'tags', 'refs', 'public', 'owner', 'role', 'target'] as const)(
  'full snapshot CAS refuses %s drift without timestamp changes and leaves all coupled state untouched',
  async (drift) => {
    await using h = await harness()
    const previous = await h.snapshot()

    if (drift === 'content')
      await h.db
        .update(postsTable)
        .set({ content: 'Other source' })
        .where(eq(postsTable.id, h.postId))

    if (drift === 'tags') {
      await h.db.insert(labelsTable).values({ id: 'label', name: 'other', kind: 'tag' })
      await h.db
        .insert(entityLabelsTable)
        .values({ entityType: 'post', entityId: h.postId, labelId: 'label', position: 0 })
    }

    if (drift === 'refs')
      await h.db
        .insert(postMusicReferencesTable)
        .values({ postId: h.postId, position: 0, trackId: h.track.entityId })

    if (drift === 'public')
      await h.db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, h.postId))

    if (drift === 'owner') await h.db.delete(postCreators).where(eq(postCreators.postId, h.postId))

    if (drift === 'role') await h.db.update(user).set({ role: 'user' }).where(eq(user.id, ownerId))

    if (drift === 'target')
      await h.db
        .update(musicPlaylistsTable)
        .set({ publishedAt: null })
        .where(eq(musicPlaylistsTable.id, h.playlist.entityId))
    const before = await h.state()
    expect(
      await h.run(
        saveEditorialChange(
          h.db,
          ownerId,
          previous,
          {
            title: 'Must not save',
            tags: ['new-tag'],
            musicReferences: { references: [h.playlist], primary: h.playlist },
          },
          {
            id: crypto.randomUUID(),
            actorId: ownerId,
            postId: h.postId,
            inputHash: 'test',
            result: '{}',
            createdAt: new Date(),
          },
          draftMusicTargetsGuard(h.db, [h.playlist], new Date()),
          sql`1`,
        ),
      ),
    ).toBe(false)
    expect(await h.state()).toEqual(before)
  },
)

test.each(['ABORT', 'IGNORE'] as const)(
  'same-snapshot writes have one winner and receipt %s rolls the whole post/tags/refs transition back',
  async (mode) => {
    await using h = await harness()
    const input = await h.mutation()

    const results = await Promise.allSettled(
      ['first', 'second'].map((tag) =>
        h.run(
          Effect.flatMap(EditorialMusicService, (s) =>
            s.setDraftTags({ ...input, requestId: crypto.randomUUID(), tags: [tag] }),
          ),
        ),
      ),
    )

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(
      await h.run(
        saveEditorialChange(
          h.db,
          ownerId,
          await h.snapshot(),
          {
            title: 'Combined',
            tags: ['combined'],
            musicReferences: { references: [h.track, h.playlist], primary: h.track },
          },
          {
            id: crypto.randomUUID(),
            actorId: ownerId,
            postId: h.postId,
            inputHash: 'combined',
            result: '{}',
            createdAt: new Date(),
          },
          undefined,
          sql`1`,
        ),
      ),
    ).toBe(true)
    const previous = await h.snapshot()
    expect(previous.title).toBe('Combined')
    expect(previous.tags).toEqual(['combined'])
    expect(previous.musicReferences).toEqual({
      references: [h.track, h.playlist],
      primary: h.track,
    })
    const before = await h.state()
    await h.db.$client
      .prepare(
        `CREATE TRIGGER reject_editorial_receipt BEFORE INSERT ON editorial_operations BEGIN SELECT RAISE(${mode === 'IGNORE' ? 'IGNORE' : "ABORT, 'fixture failure'"}); END`,
      )
      .run()
    await expect(
      h.run(
        saveEditorialChange(
          h.db,
          ownerId,
          previous,
          {
            title: 'Rollback',
            tags: ['rollback'],
            musicReferences: { references: [h.track, h.playlist], primary: h.playlist },
          },
          {
            id: crypto.randomUUID(),
            actorId: ownerId,
            postId: h.postId,
            inputHash: 'test',
            result: '{}',
            createdAt: new Date(),
          },
          undefined,
          sql`1`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'unavailable' })
    expect(await h.state()).toEqual(before)
  },
)

test('a live account predicate revoked during coupled writes aborts the full batch at final assertion', async () => {
  await using h = await harness()
  const previous = await h.snapshot()
  const before = await h.state()
  await h.db.$client
    .prepare(
      `CREATE TRIGGER revoke_during_tags AFTER INSERT ON entity_labels BEGIN UPDATE user SET banned = 1 WHERE id = 'owner'; END`,
    )
    .run()
  await expect(
    h.run(
      saveEditorialChange(
        h.db,
        ownerId,
        previous,
        {
          title: 'Must roll back',
          tags: ['revoke'],
          musicReferences: { references: [h.track], primary: h.track },
        },
        {
          id: crypto.randomUUID(),
          actorId: ownerId,
          postId: h.postId,
          inputHash: 'test',
          result: '{}',
          createdAt: new Date(),
        },
        undefined,
        sql`EXISTS (SELECT 1 FROM user WHERE id = ${ownerId} AND coalesce(banned, 0) = 0)`,
      ),
    ),
  ).rejects.toMatchObject({ code: 'unavailable' })
  expect(await h.state()).toEqual(before)
  expect((await h.db.select().from(user).where(eq(user.id, ownerId)))[0]?.banned).toBe(false)
})

test('preview/mentions do not persist, embed insertion is not attachment, and replay expires exactly at 24h without reapplying', async () => {
  await using h = await harness()
  const initial = await h.state()
  await h.run(
    Effect.flatMap(EditorialMusicService, (s) =>
      s.preview({ content: '## Preview\n\n::music{type="track" id="missing"}' }),
    ),
  )
  await h.run(
    Effect.flatMap(EditorialMusicService, (s) =>
      s.findMentions({ content: `::music{type="track" id="${h.track.entityId}"}` }),
    ),
  )
  expect(await h.state()).toEqual(initial)
  const input = { ...(await h.mutation()), target: h.track, offset: 0 }

  const inserted = await h.run(
    Effect.flatMap(EditorialMusicService, (s) => s.insertMusicEmbed(input)),
  )

  expect(inserted.post.content).toContain(`id="${h.track.entityId}"`)
  expect((await h.snapshot()).musicReferences).toEqual({ references: [], primary: null })
  const [receipt] = await h.db.select().from(editorialOperations)

  if (!receipt) throw new Error('Missing receipt')

  const at = (now: number) =>
    Effect.clockWith((clock) =>
      Effect.flatMap(EditorialMusicService, (s) => s.insertMusicEmbed(input)).pipe(
        Effect.provideService(Clock.Clock, {
          currentTimeMillis: Effect.succeed(now),
          currentTimeMillisUnsafe: () => now,
          currentTimeNanos: Effect.succeed(BigInt(now) * 1_000_000n),
          currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
          monotonicTimeNanos: clock.monotonicTimeNanos,
          monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
          sleep: (duration) => clock.sleep(duration),
        }),
      ),
    )

  expect(await h.run(at(receipt.createdAt.getTime() + 24 * 60 * 60 * 1000 - 1))).toEqual(inserted)
  const saved = await h.state()
  await expect(h.run(at(receipt.createdAt.getTime() + 24 * 60 * 60 * 1000))).rejects.toMatchObject({
    code: 'expired',
  })
  expect(await h.state()).toEqual(saved)
  await h.db
    .update(editorialOperations)
    .set({ result: null })
    .where(eq(editorialOperations.id, receipt.id))
  await expect(
    h.run(Effect.flatMap(EditorialMusicService, (s) => s.insertMusicEmbed(input))),
  ).rejects.toMatchObject({ code: 'expired' })
})

test('cross-owner admin, published drafts, revoked scopes and hidden playlists cannot be used to mutate or disclose saved receipts', async () => {
  await using h = await harness()
  const input = { ...(await h.mutation()), target: h.playlist, position: 0, primary: true }
  await h.db
    .update(musicPlaylistsTable)
    .set({ publishedAt: new Date(Date.now() + 60_000) })
    .where(eq(musicPlaylistsTable.id, h.playlist.entityId))
  await expect(
    h.run(Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(input))),
  ).rejects.toMatchObject({ code: 'not_found' })
  await h.db
    .update(musicPlaylistsTable)
    .set({ publishedAt: new Date(0) })
    .where(eq(musicPlaylistsTable.id, h.playlist.entityId))
  await expect(
    h.run(
      Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(input)),
      { ...principal, userId: Schema.decodeUnknownSync(UserId)('other') },
    ),
  ).rejects.toMatchObject({ code: 'not_found' })
  await h.run(Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(input)))
  await expect(
    h.run(
      Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(input)),
      { ...principal, scopes: ['posts:read', 'drafts:write'] },
    ),
  ).rejects.toMatchObject({ code: 'access_denied' })
  await h.db.update(postsTable).set({ draft: false }).where(eq(postsTable.id, h.postId))
  await expect(
    h.run(Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(input))),
  ).rejects.toMatchObject({ code: 'not_found' })
  const [published] = await h.db.select().from(postsTable).where(eq(postsTable.id, h.postId))

  if (!published) throw new Error('Missing published fixture')
  const refs = await h.db.select().from(postMusicReferencesTable)
  expect(
    await guardedPostUpdate(
      h.db,
      published,
      ownerId,
      {
        title: 'Allowed title edit',
        musicEntityType: 'playlist',
        musicEntityId: h.playlist.entityId.toUpperCase(),
      },
      undefined,
      [],
    ),
  ).toHaveLength(1)
  expect(await h.db.select().from(postMusicReferencesTable)).toEqual(refs)
  const before = await h.state()
  await expect(
    guardedPostUpdate(
      h.db,
      published,
      ownerId,
      {
        musicEntityType: 'track',
        musicEntityId: h.track.entityId,
      },
      undefined,
      [],
    ),
  ).rejects.toBeInstanceOf(ValidationError)
  expect(await h.state()).toEqual(before)
})

test('read snapshots enforce authored/private versus public access and legacy fallback is represented once without marker inference', async () => {
  await using h = await harness()
  const otherId = Schema.decodeUnknownSync(UserId)('other')
  await expect(
    Effect.runPromise(loadReadableEditorialSnapshot(h.db, h.postId, otherId)),
  ).rejects.toMatchObject({ code: 'not_found' })
  await h.db
    .update(postsTable)
    .set({ musicEntityType: 'track', musicEntityId: h.track.entityId })
    .where(eq(postsTable.id, h.postId))
  const legacy = await h.snapshot()
  expect(legacy.musicReferences).toEqual({ references: [h.track], primary: h.track })
  expect(legacy.storedMusicReferences.references).toEqual([])
  const legacyVersion = await h.version()
  await h.db
    .update(postsTable)
    .set({ musicReferencesManaged: true, musicEntityType: null, musicEntityId: null, draft: false })
    .where(eq(postsTable.id, h.postId))

  const publicSource = await Effect.runPromise(
    loadReadableEditorialSnapshot(h.db, h.postId, otherId),
  )

  expect(publicSource.musicReferences).toEqual({ references: [], primary: null })
  expect((await h.version()).version).not.toBe(legacyVersion.version)
  await h.db
    .update(postsTable)
    .set({ musicEntityType: 'track', musicEntityId: h.track.entityId })
    .where(eq(postsTable.id, h.postId))
  await expect(h.snapshot()).rejects.toMatchObject({ code: 'unavailable' })
})

test('case-insensitive target identity preserves stored UUID spelling and rejects ambiguous case collisions', async () => {
  await using h = await harness()

  const stored = DraftMusicTarget.make({
    entityType: 'track',
    entityId: 'AaBbCcDd-aBcD-4AbC-8dEf-aAbBcCdDeEfF',
  })

  await h.db
    .insert(musicTracksTable)
    .values({ id: stored.entityId, title: 'Mixed case', slug: 'mixed-case' })

  const input = {
    ...(await h.mutation()),
    target: { ...stored, entityId: stored.entityId.toLowerCase() },
    position: 0,
    primary: true,
  }

  const result = await h.run(Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(input)))
  expect(result.post.musicReferences.references).toEqual([stored])
  expect(result.post.musicReferences.primary).toEqual(stored)
  expect((await h.db.select().from(postMusicReferencesTable))[0]?.trackId).toBe(stored.entityId)
  expect(
    await h.run(
      Effect.flatMap(EditorialMusicService, (s) =>
        s.attachMusic({ ...input, target: { ...stored, entityId: stored.entityId.toUpperCase() } }),
      ),
    ),
  ).toEqual(result)
  await h.db
    .insert(musicTracksTable)
    .values({ id: stored.entityId.toLowerCase(), title: 'Ambiguous', slug: 'ambiguous' })
  const retry = await h.run(Effect.flatMap(EditorialMusicService, (s) => s.attachMusic(input)))
  expect(retry.post.musicReferences.display).toEqual([
    DraftReferenceDisplay.cases.Unavailable.make({ target: stored }),
  ])
  const insert = { ...(await h.mutation()), target: input.target, offset: 0 }
  const before = await h.state()
  await expect(
    h.run(Effect.flatMap(EditorialMusicService, (s) => s.insertMusicEmbed(insert))),
  ).rejects.toMatchObject({ code: 'unavailable' })
  expect(await h.state()).toEqual(before)
})

test('fresh Unicode tag snapshots save successfully while same-cardinality membership drift still refuses', async () => {
  await using h = await harness()
  const input = { ...(await h.mutation()), tags: ['😀', 'Ａ'] }
  await h.run(Effect.flatMap(EditorialMusicService, (s) => s.setDraftTags(input)))
  const previous = await h.snapshot()

  const receipt = {
    id: crypto.randomUUID(),
    actorId: ownerId,
    postId: h.postId,
    inputHash: 'unicode',
    result: '{}',
    createdAt: new Date(),
  }

  expect(
    await h.run(
      saveEditorialChange(
        h.db,
        ownerId,
        previous,
        { title: 'Unicode saved' },
        receipt,
        undefined,
        sql`1`,
      ),
    ),
  ).toBe(true)
  const current = await h.snapshot()
  await h.db.update(labelsTable).set({ name: 'different' }).where(eq(labelsTable.name, '😀'))
  const before = await h.state()
  expect(
    await h.run(
      saveEditorialChange(
        h.db,
        ownerId,
        current,
        { title: 'Must not save' },
        { ...receipt, id: crypto.randomUUID() },
        undefined,
        sql`1`,
      ),
    ),
  ).toBe(false)
  expect(await h.state()).toEqual(before)
})
