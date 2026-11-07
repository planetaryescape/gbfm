import type { RichContentDocument } from '@gbfm/rich-content/schema'
import { type InferInsertModel, type InferSelectModel, relations, sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  primaryKey,
  text,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'
import { defaultContentFields } from './util'

export const POST_MUSIC_ENTITY_TYPES = ['album', 'track', 'playlist'] as const

export type PostMusicEntityType = (typeof POST_MUSIC_ENTITY_TYPES)[number]

export const postTypeEnum = ['post', 'micro'] as const

// todo: derive this at some point bossman
export type PostType = 'post' | 'micro'

const { title: _title, content: _content, ...postContentFields } = defaultContentFields

export const postsTable = sqliteTable(
  'posts',
  {
    ...postContentFields,
    title: text(),
    content: text(),
    type: text({ enum: postTypeEnum }),
    musicEntityType: text('music_entity_type'),
    musicEntityId: text('music_entity_id'),
    lastOperationId: text('last_operation_id'),
    musicReferencesManaged: integer('music_references_managed', { mode: 'boolean' })
      .notNull()
      .default(false),
    parentPostId: text('parent_post_id').references((): AnySQLiteColumn => postsTable.id, {
      onDelete: 'set null',
    }),
    rootPostId: text('root_post_id').references((): AnySQLiteColumn => postsTable.id, {
      onDelete: 'set null',
    }),
    depth: integer('depth').notNull().default(0),
    quotedPostId: text('quoted_post_id').references((): AnySQLiteColumn => postsTable.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('posts_slug_idx').on(table.slug),
    index('posts_music_entity_idx').on(table.musicEntityType, table.musicEntityId),
    index('posts_type_created_idx').on(table.type, table.createdAt),
    index('posts_parent_created_idx').on(table.parentPostId, table.createdAt),
    index('posts_root_created_idx').on(table.rootPostId, table.createdAt),
    index('posts_quoted_post_idx').on(table.quotedPostId),
    check(
      'posts_operation_check',
      sql`${table.lastOperationId} IS NULL OR length(${table.lastOperationId}) = 36`,
    ),
    check('posts_music_references_managed_check', sql`${table.musicReferencesManaged} IN (0, 1)`),
  ],
)

export type SelectPost = InferSelectModel<typeof postsTable> & { tags: Array<string> | null }

export type InsertPost = InferInsertModel<typeof postsTable> & { tags?: Array<string> }

export type BlueskySourceAttribution = {
  readonly authorDid: string
  readonly authorHandle: string | null
  readonly publicUrl: string
  readonly sourceCreatedAt: Date | string
  readonly sourceStatus: string
  readonly locallyEdited: boolean
  readonly lastError: string | null
}

export type SelectMdxCompiledPost = SelectPost & {
  compiledContent: string
  richContent: RichContentDocument
  blueskySource?: BlueskySourceAttribution
  creators?:
    | Array<{
        id: string
        name: string
        username: string | null
        image: string | null
      }>
    | undefined
  replyCount?: number
}

export type SelectMdxCompiledEditorialPost = SelectMdxCompiledPost & {
  title: string
  content: string
  type: 'post'
}

export type SelectMdxCompiledMicroPost = SelectMdxCompiledPost & {
  type: 'micro'
}

export const postCreators = sqliteTable(
  'post_creators',
  {
    postId: text()
      .notNull()
      .references(() => postsTable.id),
    creatorId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.creatorId] }),
    index('post_creators_creatorId_idx').on(t.creatorId),
  ],
)

export const postsRelations = relations(postsTable, ({ many }) => ({
  postCreators: many(postCreators),
}))

export const postCreatorsRelations = relations(postCreators, ({ one }) => ({
  post: one(postsTable, {
    fields: [postCreators.postId],
    references: [postsTable.id],
  }),
  creator: one(user, {
    fields: [postCreators.creatorId],
    references: [user.id],
  }),
}))
