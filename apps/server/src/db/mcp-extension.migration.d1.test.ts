import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { expect, test } from 'vitest'

import { applyD1Migrations, createMigratedD1Database, d1MigrationFiles } from '@/test/migrate-d1'

import { audioTable } from './audio.schema'
import { user } from './auth.schema'
import { musicMetadataProposalsTable } from './metadata-review.schema'
import { musicEntityMergesTable } from './music-merge.schema'
import { oauthClient, oauthResource } from './oauth.schema'
import { showsTable } from './show.schema'

test('creator revision migration preserves populated content without inventing attempts', async () => {
  await using resource = await createMigratedD1Database(
    d1MigrationFiles.filter((name) => name < '0022'),
  )

  const d1 = resource.database
  await d1
    .prepare(
      "INSERT INTO shows(id,title,slug,content,createdAt,updatedAt) VALUES('show','Show','show','Body',3,4)",
    )
    .run()
  await d1
    .prepare(
      "INSERT INTO audio(id,title,slug,content,type,url,showId,createdAt,updatedAt) VALUES('audio','Mix','mix','Mix body','mix','https://example.test/mix','show',5,6)",
    )
    .run()
  await applyD1Migrations(d1, ['0022_creator_revisions.sql'])
  const db = drizzle(d1)
  expect(await db.select().from(showsTable)).toMatchObject([
    { id: 'show', content: 'Body', revision: 0, lastOperationId: null },
  ])
  expect(await db.select().from(audioTable)).toMatchObject([
    { id: 'audio', showId: 'show', content: 'Mix body', revision: 0, lastOperationId: null },
  ])

  for (const table of ['audio', 'shows']) {
    for (const revision of [-1, 1.5, 9007199254740992]) {
      await expect(
        d1.prepare(`UPDATE ${table} SET revision=?`).bind(revision).run(),
      ).rejects.toThrow()
    }

    await d1.prepare(`UPDATE ${table} SET revision=9007199254740991`).run()
    await expect(d1.prepare(`UPDATE ${table} SET revision=revision+1`).run()).rejects.toThrow()
    await expect(d1.prepare(`UPDATE ${table} SET last_operation_id='bad'`).run()).rejects.toThrow()
    await d1
      .prepare(`UPDATE ${table} SET revision=1,last_operation_id=?`)
      .bind('12345678-1234-4234-8234-123456789012')
      .run()
  }

  await db.insert(showsTable).values({ id: 'fresh', title: 'Fresh', slug: 'fresh', content: '' })
  expect(await db.select().from(showsTable).where(eq(showsTable.id, 'fresh'))).toMatchObject([
    { revision: 0, lastOperationId: null },
  ])
})

const proposal = {
  id: 'proposal',
  actorId: 'actor',
  clientId: 'client',
  resource: 'https://example.test/mcp',
  targetType: 'artist',
  targetId: 'no-catalogue-fk',
  targetRevision: 7,
  field: 'bio',
  currentValue: 'null',
  proposedValue: JSON.stringify('Proposed biography'),
  evidence: [{ linkId: 'stored-link', reason: 'Published credit' }],
  proposalHash: 'a'.repeat(64),
  createdAt: 11,
  updatedAt: 12,
} as const

test('metadata proposals preserve scalar null and pending-only owner-scoped duplicate identity', async () => {
  await using resource = await createMigratedD1Database(
    d1MigrationFiles.filter((name) => name < '0023'),
  )

  await applyD1Migrations(resource.database, ['0023_metadata_review.sql'])
  const db = drizzle(resource.database)
  await db.insert(user).values([
    { id: 'actor', name: 'Actor', email: 'actor@example.test' },
    { id: 'other', name: 'Other', email: 'other@example.test' },
  ])
  await db.insert(oauthClient).values({ id: 'client-row', clientId: 'client', redirectUris: '[]' })
  await db
    .insert(oauthResource)
    .values({ id: 'resource', identifier: proposal.resource, name: 'MCP' })
  await db.insert(musicMetadataProposalsTable).values(proposal)
  expect(await db.select().from(musicMetadataProposalsTable)).toMatchObject([
    {
      currentValue: 'null',
      status: 'pending',
      revision: 0,
      lastOperationId: null,
      evidence: proposal.evidence,
    },
  ])
  await expect(
    db.insert(musicMetadataProposalsTable).values({ ...proposal, id: 'duplicate' }),
  ).rejects.toThrow()
  await db
    .insert(musicMetadataProposalsTable)
    .values({ ...proposal, id: 'other-owner', actorId: 'other' })
  await db
    .update(musicMetadataProposalsTable)
    .set({ status: 'rejected' })
    .where(eq(musicMetadataProposalsTable.id, 'proposal'))
  await db.insert(musicMetadataProposalsTable).values({ ...proposal, id: 'new-pending' })

  for (const set of [
    "field='title'",
    'current_value=NULL',
    "proposed_value='{}'",
    "proposed_value='null'",
    "evidence='[]'",
    "evidence='{}'",
    "evidence='[1,2,3,4,5,6]'",
    "proposal_hash='A' || substr(proposal_hash,2)",
    "status='unknown'",
    'target_revision=-1',
    'revision=1.5',
    'revision=9007199254740992',
    "last_operation_id='bad'",
    'updated_at=10',
    'created_at=0.5',
  ]) {
    await expect(
      resource.database
        .prepare(`UPDATE music_metadata_proposals SET ${set} WHERE id='new-pending'`)
        .run(),
    ).rejects.toThrow()
  }

  await expect(
    db.insert(musicMetadataProposalsTable).values({
      ...proposal,
      id: 'long',
      targetId: 'long-target',
      proposedValue: JSON.stringify('x'.repeat(2001)),
    }),
  ).rejects.toThrow()

  for (const targetType of ['artist', 'album', 'track', 'label'] as const) {
    const field = targetType === 'artist' || targetType === 'label' ? 'name' : 'title'

    const nameProposal = {
      ...proposal,
      id: targetType,
      targetType,
      field,
      currentValue: JSON.stringify('Original'),
      proposedValue: JSON.stringify('x'.repeat(500)),
    } satisfies typeof musicMetadataProposalsTable.$inferInsert

    await db.insert(musicMetadataProposalsTable).values(nameProposal)
    await expect(
      db
        .update(musicMetadataProposalsTable)
        .set({ proposedValue: JSON.stringify('x'.repeat(501)) })
        .where(eq(musicMetadataProposalsTable.id, targetType)),
    ).rejects.toThrow()
    await expect(
      db
        .update(musicMetadataProposalsTable)
        .set({ proposedValue: 'null' })
        .where(eq(musicMetadataProposalsTable.id, targetType)),
    ).rejects.toThrow()
  }

  await expect(
    db
      .insert(musicMetadataProposalsTable)
      .values({ ...proposal, id: 'bad-fk', clientId: 'missing' }),
  ).rejects.toThrow()
})

test.each(['actor', 'client', 'resource'] as const)(
  'metadata proposals erase private content on %s deletion',
  async (dependency) => {
    await using resource = await createMigratedD1Database(
      d1MigrationFiles.filter((name) => name < '0023'),
    )

    await applyD1Migrations(resource.database, ['0023_metadata_review.sql'])
    const db = drizzle(resource.database)
    await db.insert(user).values({ id: 'actor', name: 'Actor', email: 'actor@example.test' })
    await db
      .insert(oauthClient)
      .values({ id: 'client-row', clientId: 'client', redirectUris: '[]' })
    await db
      .insert(oauthResource)
      .values({ id: 'resource', identifier: proposal.resource, name: 'MCP' })
    await db.insert(musicMetadataProposalsTable).values(proposal)

    if (dependency === 'actor') await db.delete(user).where(eq(user.id, 'actor'))

    if (dependency === 'client')
      await db.delete(oauthClient).where(eq(oauthClient.clientId, 'client'))

    if (dependency === 'resource')
      await db.delete(oauthResource).where(eq(oauthResource.identifier, proposal.resource))
    expect(await db.select().from(musicMetadataProposalsTable)).toEqual([])
  },
)

test('merge history bounds UTF8 images and retains redirects independently of undo and receipts', async () => {
  await using resource = await createMigratedD1Database(
    d1MigrationFiles.filter((name) => name < '0024'),
  )

  await applyD1Migrations(resource.database, ['0024_music_entity_merges.sql'])
  const db = drizzle(resource.database)

  const merge = {
    operationId: 'a'.repeat(64),
    entityType: 'artist',
    sourceId: 'gone',
    targetId: 'survivor',
    sourceSlug: 'old-name',
    beforeImage: JSON.stringify({ name: 'Source' }),
    afterDigest: 'b'.repeat(64),
    createdAt: 17,
    undoExpiresAt: 86400017,
  } as const

  await db.insert(musicEntityMergesTable).values(merge)
  await expect(
    db.insert(musicEntityMergesTable).values({ ...merge, operationId: 'c'.repeat(64) }),
  ).rejects.toThrow()
  await db
    .insert(musicEntityMergesTable)
    .values({ ...merge, operationId: 'd'.repeat(64), entityType: 'album' })

  for (const set of [
    "entity_type='unknown'",
    'source_id=target_id',
    "source_slug=''",
    "before_image='not-json'",
    "after_digest='B' || substr(after_digest,2)",
    'created_at=-1',
    'undo_expires_at=86400016',
    'restored_at=16',
  ]) {
    await expect(
      resource.database
        .prepare(`UPDATE music_entity_merges SET ${set} WHERE operation_id=?`)
        .bind(merge.operationId)
        .run(),
    ).rejects.toThrow()
  }

  const exactByteImage = JSON.stringify('é'.repeat(131071))
  expect(new TextEncoder().encode(exactByteImage).length).toBe(262144)
  await db
    .update(musicEntityMergesTable)
    .set({ beforeImage: exactByteImage })
    .where(eq(musicEntityMergesTable.operationId, merge.operationId))
  await expect(
    db
      .update(musicEntityMergesTable)
      .set({ beforeImage: JSON.stringify('é'.repeat(131072)) })
      .where(eq(musicEntityMergesTable.operationId, merge.operationId)),
  ).rejects.toThrow()
  await db
    .update(musicEntityMergesTable)
    .set({ beforeImage: null })
    .where(eq(musicEntityMergesTable.operationId, merge.operationId))
  expect(
    await db
      .select()
      .from(musicEntityMergesTable)
      .where(eq(musicEntityMergesTable.operationId, merge.operationId)),
  ).toMatchObject([{ sourceId: 'gone', targetId: 'survivor', beforeImage: null }])
  await db
    .update(musicEntityMergesTable)
    .set({ restoredAt: 18 })
    .where(eq(musicEntityMergesTable.operationId, merge.operationId))
  await db.insert(musicEntityMergesTable).values({ ...merge, operationId: 'e'.repeat(64) })
})
