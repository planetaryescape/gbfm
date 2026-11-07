import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'

/** External saves are owned by listeners, independent of the GBFM audio catalog. */
export const savedMixesTable = sqliteTable(
  'saved_mixes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    platform: text('platform', {
      enum: ['youtube', 'spotify', 'soundcloud', 'mixcloud'],
    }).notNull(),
    embedUrl: text('embed_url'),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    status: text('status', { enum: ['to-listen', 'listening', 'listened'] })
      .notNull()
      .default('to-listen'),
    published: integer('published', { mode: 'boolean' }).notNull().default(false),
    revision: integer('revision').notNull().default(1),
    lastOperationId: text('last_operation_id'),
    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    unique('saved_mixes_owner_url').on(t.userId, t.url),
    index('saved_mixes_owner').on(t.userId),
    check(
      'saved_mixes_revision_check',
      sql`typeof(${t.revision}) = 'integer' AND ${t.revision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      'saved_mixes_operation_check',
      sql`${t.lastOperationId} IS NULL OR length(${t.lastOperationId}) = 36`,
    ),
  ],
)

/** Collection visibility never overrides an individual mix's private state. */
export const listeningCollectionsTable = sqliteTable(
  'listening_collections',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    published: integer('published', { mode: 'boolean' }).notNull().default(false),
    revision: integer('revision').notNull().default(1),
    lastOperationId: text('last_operation_id'),
    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    index('listening_collections_owner').on(t.userId),
    check(
      'listening_collections_revision_check',
      sql`typeof(${t.revision}) = 'integer' AND ${t.revision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      'listening_collections_operation_check',
      sql`${t.lastOperationId} IS NULL OR length(${t.lastOperationId}) = 36`,
    ),
  ],
)

/** Many collections can reference the same saved mix and its single notes field. */
export const listeningMembershipsTable = sqliteTable(
  'listening_memberships',
  {
    collectionId: text('collection_id')
      .notNull()
      .references(() => listeningCollectionsTable.id, { onDelete: 'cascade' }),
    mixId: text('mix_id')
      .notNull()
      .references(() => savedMixesTable.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.mixId] })],
)

/** Persists even for an empty library; only account deletion resets this identity. */
export const listenerMembershipRevisions = sqliteTable(
  'listener_membership_revisions',
  {
    userId: text('user_id')
      .primaryKey()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull().default(0),
    lastTransitionId: text('last_transition_id'),
  },
  (t) => [
    check(
      'listener_membership_revision_check',
      sql`typeof(${t.revision}) = 'integer' AND ${t.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'listener_membership_transition_check',
      sql`(${t.revision} = 0 AND ${t.lastTransitionId} IS NULL) OR (${t.revision} > 0 AND ${t.lastTransitionId} IS NOT NULL AND length(${t.lastTransitionId}) = 36)`,
    ),
  ],
)
