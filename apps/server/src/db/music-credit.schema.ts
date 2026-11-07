import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'
import { musicAlbumsTable, musicArtistsTable, musicTracksTable } from './music-entity.schema'

/** Asserted facts are separate from artist billing, display names and source identity. */
export const musicRecordingCreditsTable = sqliteTable(
  'music_recording_credits',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    trackId: text('track_id').references(() => musicTracksTable.id, { onDelete: 'cascade' }),
    albumId: text('album_id').references(() => musicAlbumsTable.id, { onDelete: 'cascade' }),
    artistId: text('artist_id').references(() => musicArtistsTable.id, { onDelete: 'restrict' }),
    creditedName: text('credited_name').notNull(),
    creditedNameKey: text('credited_name_key').notNull(),
    role: text('role', { enum: ['performer', 'instrument', 'producer', 'engineer'] }).notNull(),
    instrument: text('instrument'),
    instrumentKey: text('instrument_key').notNull(),
    participantKey: text('participant_key').notNull(),
    displayOrder: integer('display_order').notNull(),
    sourceLabel: text('source_label').notNull(),
    sourceUrl: text('source_url'),
    evidenceNote: text('evidence_note'),
    assertedById: text('asserted_by_id').references(() => user.id, { onDelete: 'set null' }),
    assertedAt: integer('asserted_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    check(
      'music_recording_credits_target_check',
      sql`(${t.trackId} IS NOT NULL) + (${t.albumId} IS NOT NULL) = 1`,
    ),
    check(
      'music_recording_credits_role_check',
      sql`${t.role} IN ('performer', 'instrument', 'producer', 'engineer')`,
    ),
    check(
      'music_recording_credits_instrument_check',
      sql`(${t.role} = 'instrument' AND ${t.instrument} IS NOT NULL AND length(trim(${t.instrument})) > 0 AND length(${t.instrumentKey}) > 0) OR (${t.role} != 'instrument' AND ${t.instrument} IS NULL AND ${t.instrumentKey} = '')`,
    ),
    check(
      'music_recording_credits_participant_check',
      sql`${t.participantKey} = CASE WHEN ${t.artistId} IS NOT NULL THEN 'artist:' || ${t.artistId} ELSE 'name:' || ${t.creditedNameKey} END`,
    ),
    check(
      'music_recording_credits_name_check',
      sql`length(trim(${t.creditedName})) > 0 AND length(${t.creditedNameKey}) > 0`,
    ),
    check(
      'music_recording_credits_order_check',
      sql`typeof(${t.displayOrder}) = 'integer' AND ${t.displayOrder} >= 0`,
    ),
    check(
      'music_recording_credits_evidence_check',
      sql`length(trim(${t.sourceLabel})) > 0 AND ((${t.sourceUrl} IS NOT NULL AND length(trim(${t.sourceUrl})) > 0) OR (${t.evidenceNote} IS NOT NULL AND length(trim(${t.evidenceNote})) > 0))`,
    ),
    uniqueIndex('music_recording_credits_track_uq')
      .on(t.trackId, t.participantKey, t.role, t.instrumentKey)
      .where(sql`${t.trackId} IS NOT NULL`),
    uniqueIndex('music_recording_credits_album_uq')
      .on(t.albumId, t.participantKey, t.role, t.instrumentKey)
      .where(sql`${t.albumId} IS NOT NULL`),
    index('music_recording_credits_track_order_idx').on(t.trackId, t.displayOrder, t.id),
    index('music_recording_credits_album_order_idx').on(t.albumId, t.displayOrder, t.id),
  ],
)

/** Names belong to an artist, never merge identities, and survive asserting-account deletion. */
export const musicArtistAliasesTable = sqliteTable(
  'music_artist_aliases',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    artistId: text('artist_id')
      .notNull()
      .references(() => musicArtistsTable.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    sourceLabel: text('source_label').notNull(),
    sourceUrl: text('source_url'),
    evidenceNote: text('evidence_note'),
    assertedById: text('asserted_by_id').references(() => user.id, { onDelete: 'set null' }),
    assertedAt: integer('asserted_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    check(
      'music_artist_aliases_name_check',
      sql`length(trim(${t.name})) > 0 AND length(${t.nameKey}) > 0`,
    ),
    check(
      'music_artist_aliases_evidence_check',
      sql`length(trim(${t.sourceLabel})) > 0 AND ((${t.sourceUrl} IS NOT NULL AND length(trim(${t.sourceUrl})) > 0) OR (${t.evidenceNote} IS NOT NULL AND length(trim(${t.evidenceNote})) > 0))`,
    ),
    uniqueIndex('music_artist_aliases_artist_name_uq').on(t.artistId, t.nameKey),
    index('music_artist_aliases_name_idx').on(t.nameKey),
  ],
)
