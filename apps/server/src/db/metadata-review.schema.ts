import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'
import { oauthClient, oauthResource } from './oauth.schema'

/** Private proposals are not catalogue changes or a second operation ledger. */
export const musicMetadataProposalsTable = sqliteTable(
  'music_metadata_proposals',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    resource: text('resource')
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: ['artist', 'album', 'track', 'label'] }).notNull(),
    targetId: text('target_id').notNull(),
    targetRevision: integer('target_revision').notNull(),
    field: text('field', { enum: ['name', 'bio', 'title', 'description'] }).notNull(),
    // Canonical JSON.stringify(string|null), including text 'null', never SQL NULL.
    currentValue: text('current_value').notNull(),
    proposedValue: text('proposed_value').notNull(),
    evidence: text('evidence', { mode: 'json' })
      .$type<ReadonlyArray<{ readonly linkId: string; readonly reason: string }>>()
      .notNull(),
    proposalHash: text('proposal_hash').notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    revision: integer('revision').notNull().default(0),
    lastOperationId: text('last_operation_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check(
      'music_metadata_proposals_target_check',
      sql`${t.targetType} IN ('artist','album','track','label') AND length(${t.targetId}) > 0`,
    ),
    check(
      'music_metadata_proposals_field_check',
      sql`(${t.targetType} = 'artist' AND ${t.field} IN ('name','bio')) OR (${t.targetType} IN ('album','track') AND ${t.field} = 'title') OR (${t.targetType} = 'label' AND ${t.field} IN ('name','description'))`,
    ),
    check(
      'music_metadata_proposals_values_check',
      sql`json_valid(${t.currentValue}) AND json_valid(${t.proposedValue}) AND json_type(${t.currentValue}) IN ('text','null') AND json_type(${t.proposedValue}) IN ('text','null') AND instr(coalesce(json_extract(${t.currentValue}, '$'), ''), char(0)) = 0 AND instr(coalesce(json_extract(${t.proposedValue}, '$'), ''), char(0)) = 0 AND ${t.currentValue} <> ${t.proposedValue}`,
    ),
    check(
      'music_metadata_proposals_bounds_check',
      sql`CASE WHEN ${t.field} IN ('name','title') THEN json_type(${t.currentValue}) = 'text' AND length(trim(json_extract(${t.currentValue}, '$'))) > 0 AND length(json_extract(${t.currentValue}, '$')) <= 500 AND json_type(${t.proposedValue}) = 'text' AND length(trim(json_extract(${t.proposedValue}, '$'))) > 0 AND length(json_extract(${t.proposedValue}, '$')) <= 500 ELSE (json_type(${t.currentValue}) = 'null' OR length(json_extract(${t.currentValue}, '$')) <= 2000) AND (json_type(${t.proposedValue}) = 'null' OR length(json_extract(${t.proposedValue}, '$')) <= 2000) END`,
    ),
    check(
      'music_metadata_proposals_evidence_check',
      sql`json_valid(${t.evidence}) AND json_type(${t.evidence}) = 'array' AND json_array_length(${t.evidence}) BETWEEN 1 AND 5`,
    ),
    check(
      'music_metadata_proposals_hash_check',
      sql`length(${t.proposalHash}) = 64 AND ${t.proposalHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      'music_metadata_proposals_status_check',
      sql`${t.status} IN ('pending','accepted','rejected')`,
    ),
    check(
      'music_metadata_proposals_revision_check',
      sql`typeof(${t.revision}) = 'integer' AND ${t.revision} BETWEEN 0 AND 9007199254740991 AND typeof(${t.targetRevision}) = 'integer' AND ${t.targetRevision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'music_metadata_proposals_operation_check',
      sql`${t.lastOperationId} IS NULL OR length(${t.lastOperationId}) = 36`,
    ),
    check(
      'music_metadata_proposals_time_check',
      sql`typeof(${t.createdAt}) = 'integer' AND ${t.createdAt} BETWEEN 0 AND 9007199254740991 AND typeof(${t.updatedAt}) = 'integer' AND ${t.updatedAt} BETWEEN ${t.createdAt} AND 9007199254740991`,
    ),
    uniqueIndex('music_metadata_proposals_pending_uq')
      .on(
        t.actorId,
        t.clientId,
        t.resource,
        t.targetType,
        t.targetId,
        t.targetRevision,
        t.field,
        t.proposalHash,
      )
      .where(sql`${t.status} = 'pending'`),
  ],
)
