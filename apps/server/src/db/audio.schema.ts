import type { RichContentDocument } from '@gbfm/rich-content/schema'
import { type InferInsertModel, type InferSelectModel, relations, sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'
import { musicArtistsTable } from './music-entity.schema'
import { showsTable } from './show.schema'
import { defaultContentFields } from './util'

export const audioTypeEnum = ['mix', 'track', 'misc'] as const

export const audioTable = sqliteTable(
  'audio',
  {
    ...defaultContentFields,
    type: text({ enum: audioTypeEnum }).notNull(),
    url: text().notNull(),
    idempotencyKey: text(),
    idempotencyActorId: text(),
    idempotencyFingerprint: text(),
    showId: text().references(() => showsTable.id, { onDelete: 'set null' }),
    episodeNumber: integer(),
    playCount: integer().notNull().default(0),
    revision: integer().notNull().default(0),
    lastOperationId: text('last_operation_id'),
  },
  (table) => [
    check(
      'audio_revision_check',
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'audio_operation_check',
      sql`${table.lastOperationId} IS NULL OR length(${table.lastOperationId}) = 36`,
    ),
    index('audio_slug_idx').on(table.slug),
    uniqueIndex('audio_type_slug_unique').on(table.type, table.slug),
    uniqueIndex('audio_actor_idempotency_unique').on(
      table.idempotencyActorId,
      table.idempotencyKey,
    ),
    index('audio_show_idx').on(table.showId),
    index('audio_type_created_idx').on(table.type, table.createdAt),
  ],
)

type AudioPersistenceFields = 'idempotencyKey' | 'idempotencyActorId' | 'idempotencyFingerprint'

type BaseSelectAudio = Omit<InferSelectModel<typeof audioTable>, AudioPersistenceFields>

export type InsertAudio = Omit<InferInsertModel<typeof audioTable>, AudioPersistenceFields> & {
  tags?: Array<string>
  artistIds?: ReadonlyArray<string>
}

export type Creator = {
  id: string
  name: string
  username: string | null
}

export type SelectAudio = BaseSelectAudio & {
  tags: Array<string> | null
  creators?: Array<Creator>
  artists?: Array<Creator>
}

export const audioArtists = sqliteTable(
  'audio_artists',
  {
    audioId: text('audio_id')
      .notNull()
      .references(() => audioTable.id, { onDelete: 'cascade' }),
    artistId: text('artist_id')
      .notNull()
      .references(() => musicArtistsTable.id, { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.audioId, table.artistId] }),
    index('audio_artists_artist_id_idx').on(table.artistId),
  ],
)

export type SelectMdxCompiledAudio = SelectAudio & {
  compiledContent: string
  richContent: RichContentDocument
}

export const audioCreators = sqliteTable(
  'audio_creators',
  {
    audioId: text()
      .notNull()
      .references(() => audioTable.id),
    creatorId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.audioId, t.creatorId] }),
    index('audio_creators_creatorId_idx').on(t.creatorId),
  ],
)

export const audioRelations = relations(audioTable, ({ many, one }) => ({
  audioCreators: many(audioCreators),
  audioArtists: many(audioArtists),
  show: one(showsTable, {
    fields: [audioTable.showId],
    references: [showsTable.id],
  }),
}))

export const audioArtistsRelations = relations(audioArtists, ({ one }) => ({
  audio: one(audioTable, { fields: [audioArtists.audioId], references: [audioTable.id] }),
  artist: one(musicArtistsTable, {
    fields: [audioArtists.artistId],
    references: [musicArtistsTable.id],
  }),
}))

export const audioCreatorsRelations = relations(audioCreators, ({ one }) => ({
  audio: one(audioTable, {
    fields: [audioCreators.audioId],
    references: [audioTable.id],
  }),
  creator: one(user, {
    fields: [audioCreators.creatorId],
    references: [user.id],
  }),
}))
