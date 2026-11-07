import { LINK_STATUS } from '@gbfm/core/status'
import type { RichContentDocument } from '@gbfm/rich-content/schema'
import { type InferInsertModel, type InferSelectModel, relations, sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth.schema'

// ---------------------------------------------------------------------------
// Design note: entity types and platforms as seeded lookup tables
//
// Instead of TypeScript-only enums, we maintain two small reference tables
// (`music_entity_types` and `music_platforms`) that are populated by a seed
// script (`scripts/seed-music-lookups.ts`). This gives us:
//   • FK constraints at the DB level (invalid values are rejected by Postgres)
//   • Metadata on each platform/type (display name, icon, website)
//   • Admin-UI visibility into what's supported without reading TS source
//   • Same index performance for WHERE platform = 'spotify' queries — the FK
//     does not change how Postgres indexes or scans the varchar column; the
//     index on music_entity_links(platform) is what matters for search speed
//
// Adding a new platform = insert a row into music_platforms + add to the TS
// constant below so app-level type safety stays in sync.
// ---------------------------------------------------------------------------

export const MUSIC_ENTITY_TYPES = ['artist', 'album', 'track', 'playlist', 'label'] as const

export type MusicEntityType = (typeof MUSIC_ENTITY_TYPES)[number]

export const MUSIC_PLATFORMS = [
  'spotify',
  'youtube',
  'youtube_music',
  'apple_music',
  'bandcamp',
  'soundcloud',
  'tidal',
  'deezer',
  'amazon_music',
  'discord',
  'website',
  'instagram',
  'twitter',
  'musicbrainz',
  'discogs',
  'other',
] as const

export type MusicPlatform = (typeof MUSIC_PLATFORMS)[number]

export const ALBUM_TYPES = ['LP', 'EP', 'single', 'compilation'] as const

export type AlbumType = (typeof ALBUM_TYPES)[number]

export type MusicEntityMetadataValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<MusicEntityMetadataValue>
  | { readonly [key: string]: MusicEntityMetadataValue }

export type MusicEntityMetadata = Record<string, MusicEntityMetadataValue>

// ---------------------------------------------------------------------------
// Seeded lookup tables
// ---------------------------------------------------------------------------

/** Seeded — do not insert manually; use scripts/seed-music-lookups.ts */
export const musicEntityTypesTable = sqliteTable('music_entity_types', {
  id: text().primaryKey(), // 'artist' | 'album' | 'track' | 'playlist' | 'label'
  displayName: text().notNull(),
})

/** Seeded — do not insert manually; use scripts/seed-music-lookups.ts */
export const musicPlatformsTable = sqliteTable('music_platforms', {
  id: text().primaryKey(), // 'spotify' | 'bandcamp' | ...
  displayName: text().notNull(),
  websiteUrl: text(),
  iconUrl: text(),
})

// ---------------------------------------------------------------------------
// Core entity tables
// ---------------------------------------------------------------------------

export const musicArtistsTable = sqliteTable(
  'music_artists',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text().notNull(),
    bio: text(),
    revision: integer('revision').notNull().default(0),
    lastOperationId: text('last_operation_id'),
    imageUrl: text(),
    slug: text().notNull().unique(),
    publishedAt: integer({ mode: 'timestamp_ms' }),
    createdById: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('music_artists_slug_idx').on(table.slug),
    check(
      'music_artists_revision_check',
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'music_artists_operation_check',
      sql`${table.lastOperationId} IS NULL OR length(${table.lastOperationId}) = 36`,
    ),
  ],
)

export const musicAlbumsTable = sqliteTable(
  'music_albums',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text().notNull(),
    revision: integer('revision').notNull().default(0),
    lastOperationId: text('last_operation_id'),
    // Denormalized artist names for fast display without joins
    artistNames: text({ mode: 'json' }).$type<Array<string>>(),
    releaseDate: integer({ mode: 'timestamp_ms' }),
    coverImageUrl: text(),
    albumType: text(), // LP | EP | single | compilation
    slug: text().notNull().unique(),
    publishedAt: integer({ mode: 'timestamp_ms' }),
    createdById: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('music_albums_slug_idx').on(table.slug),
    check(
      'music_albums_revision_check',
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'music_albums_operation_check',
      sql`${table.lastOperationId} IS NULL OR length(${table.lastOperationId}) = 36`,
    ),
  ],
)

export const musicTracksTable = sqliteTable(
  'music_tracks',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text().notNull(),
    revision: integer('revision').notNull().default(0),
    lastOperationId: text('last_operation_id'),
    // Denormalized artist names for fast display without joins
    artistNames: text({ mode: 'json' }).$type<Array<string>>(),
    coverImageUrl: text(),
    albumId: text().references(() => musicAlbumsTable.id, {
      onDelete: 'set null',
    }),
    trackNumber: integer(),
    slug: text().notNull().unique(),
    publishedAt: integer({ mode: 'timestamp_ms' }),
    createdById: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('music_tracks_slug_idx').on(table.slug),
    check(
      'music_tracks_revision_check',
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'music_tracks_operation_check',
      sql`${table.lastOperationId} IS NULL OR length(${table.lastOperationId}) = 36`,
    ),
  ],
)

export const musicPlaylistsTable = sqliteTable(
  'music_playlists',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text().notNull(),
    description: text(),
    coverImageUrl: text(),
    curatorId: text().references(() => user.id, { onDelete: 'set null' }),
    slug: text().notNull().unique(),
    publishedAt: integer({ mode: 'timestamp_ms' }),
    createdById: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    revision: integer().notNull().default(0),
  },
  (table) => [index('music_playlists_slug_idx').on(table.slug)],
)

export const musicLabelsTable = sqliteTable(
  'music_labels',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text().notNull(),
    revision: integer('revision').notNull().default(0),
    lastOperationId: text('last_operation_id'),
    description: text(),
    imageUrl: text('image_url'),
    bannerImageUrl: text('banner_image_url'),
    slug: text().notNull().unique(),
    content: text().notNull().default(''),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('music_labels_slug_idx').on(table.slug),
    check(
      'music_labels_revision_check',
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      'music_labels_operation_check',
      sql`${table.lastOperationId} IS NULL OR length(${table.lastOperationId}) = 36`,
    ),
  ],
)

export const musicLabelCreatorsTable = sqliteTable(
  'music_label_creators',
  {
    labelId: text('label_id')
      .notNull()
      .references(() => musicLabelsTable.id, { onDelete: 'cascade' }),
    creatorId: text('creator_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.labelId, table.creatorId] })],
)

export const musicLabelArtistsTable = sqliteTable(
  'music_label_artists',
  {
    labelId: text('label_id')
      .notNull()
      .references(() => musicLabelsTable.id, { onDelete: 'cascade' }),
    artistId: text('artist_id')
      .notNull()
      .references(() => musicArtistsTable.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.labelId, table.artistId] }),
    index('music_label_artists_artist_id_idx').on(table.artistId),
  ],
)

export const musicLabelAlbumsTable = sqliteTable(
  'music_label_albums',
  {
    labelId: text('label_id')
      .notNull()
      .references(() => musicLabelsTable.id, { onDelete: 'cascade' }),
    albumId: text('album_id')
      .notNull()
      .references(() => musicAlbumsTable.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.labelId, table.albumId] }),
    index('music_label_albums_album_id_idx').on(table.albumId),
  ],
)

// ---------------------------------------------------------------------------
// Many-to-many: artists ↔ albums and artists ↔ tracks
// ---------------------------------------------------------------------------

export const musicAlbumArtistsTable = sqliteTable(
  'music_album_artists',
  {
    albumId: text()
      .notNull()
      .references(() => musicAlbumsTable.id, { onDelete: 'cascade' }),
    artistId: text()
      .notNull()
      .references(() => musicArtistsTable.id, { onDelete: 'cascade' }),
    displayOrder: integer().notNull().default(0),
    role: text(), // 'primary' | 'featured' | 'producer' | null
  },
  (table) => [primaryKey({ columns: [table.albumId, table.artistId] })],
)

export const musicTrackArtistsTable = sqliteTable(
  'music_track_artists',
  {
    trackId: text()
      .notNull()
      .references(() => musicTracksTable.id, { onDelete: 'cascade' }),
    artistId: text()
      .notNull()
      .references(() => musicArtistsTable.id, { onDelete: 'cascade' }),
    displayOrder: integer().notNull().default(0),
    role: text(),
  },
  (table) => [primaryKey({ columns: [table.trackId, table.artistId] })],
)

// ---------------------------------------------------------------------------
// Many-to-many: playlists ↔ tracks
// ---------------------------------------------------------------------------

export const musicPlaylistTracksTable = sqliteTable(
  'music_playlist_tracks',
  {
    playlistId: text()
      .notNull()
      .references(() => musicPlaylistsTable.id, { onDelete: 'cascade' }),
    trackId: text()
      .notNull()
      .references(() => musicTracksTable.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    addedAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.playlistId, table.trackId] }),
    index('music_playlist_tracks_position_idx').on(table.playlistId, table.position),
  ],
)

// ---------------------------------------------------------------------------
// Platform links — the core of the agnostic storage
// ---------------------------------------------------------------------------

/**
 * Each music entity (artist, album, track, playlist, label) can have many links,
 * one per platform. Both `entityType` and `platform` are FK-constrained to
 * their respective seeded lookup tables so invalid values are rejected at the
 * database level.
 */
export const musicEntityLinksTable = sqliteTable(
  'music_entity_links',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // FK to music_entity_types — ensures only valid entity types are stored
    entityType: text('entity_type')
      .notNull()
      .references(() => musicEntityTypesTable.id),
    entityId: text().notNull(),
    // FK to music_platforms — ensures only known platforms are stored
    platform: text()
      .notNull()
      .references(() => musicPlatformsTable.id),
    url: text().notNull(),
    status: text().notNull().default(LINK_STATUS.VERIFIED),
    scrapedAt: integer({ mode: 'timestamp_ms' }),
    verifiedAt: integer({ mode: 'timestamp_ms' }),
    verifiedBy: text().references(() => user.id, { onDelete: 'set null' }),
    metadata: text({ mode: 'json' }).$type<MusicEntityMetadata>(),
    createdAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('music_entity_links_entity_idx').on(table.entityType, table.entityId),
    index('music_entity_links_status_idx').on(table.status),
    index('music_entity_links_platform_idx').on(table.platform),
    index('music_entity_links_backfill_page_idx').on(table.createdAt, table.id),
    uniqueIndex('music_entity_links_identity_uq').on(
      table.entityType,
      table.entityId,
      table.platform,
    ),
  ],
)

export const MUSIC_SOURCE_IDENTITY_STATES = ['resolving', 'resolved'] as const

export type MusicSourceIdentityState = (typeof MUSIC_SOURCE_IDENTITY_STATES)[number]

export const MUSIC_SOURCE_CONFLICT_STATUSES = ['open', 'resolved', 'ignored'] as const

export type MusicSourceConflictStatus = (typeof MUSIC_SOURCE_CONFLICT_STATUSES)[number]

export const musicSourceIdentitiesTable = sqliteTable(
  'music_source_identities',
  {
    sourceKey: text('source_key').primaryKey(),
    platform: text()
      .notNull()
      .references(() => musicPlatformsTable.id),
    sourceEntityType: text('source_entity_type').notNull(),
    externalId: text('external_id'),
    canonicalUrl: text('canonical_url').notNull(),
    state: text().$type<MusicSourceIdentityState>().notNull(),
    entityType: text('entity_type').references(() => musicEntityTypesTable.id),
    entityId: text('entity_id'),
    ownerToken: text('owner_token'),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    lastScrapedAt: integer('last_scraped_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('music_source_identities_canonical_url_uq').on(table.canonicalUrl),
    uniqueIndex('music_source_identities_provider_id_uq')
      .on(table.platform, table.sourceEntityType, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`),
    index('music_source_identities_entity_idx').on(table.entityType, table.entityId),
    index('music_source_identities_lease_idx').on(table.state, table.leaseExpiresAt),
    index('music_source_identities_resolving_audit_page_idx').on(table.state, table.sourceKey),
    check(
      'music_source_identities_state_check',
      sql`(${table.state} = 'resolving' AND ${table.ownerToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL AND ${table.entityType} IS NULL AND ${table.entityId} IS NULL AND ${table.resolvedAt} IS NULL) OR (${table.state} = 'resolved' AND ${table.ownerToken} IS NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.entityType} IS NOT NULL AND ${table.entityId} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`,
    ),
  ],
)

export const musicSourceAliasesTable = sqliteTable(
  'music_source_aliases',
  {
    normalizedUrl: text('normalized_url').primaryKey(),
    sourceKey: text('source_key')
      .notNull()
      .references(() => musicSourceIdentitiesTable.sourceKey, { onDelete: 'cascade' }),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('music_source_aliases_source_key_idx').on(table.sourceKey)],
)

export const musicSourceIdentityConflictsTable = sqliteTable(
  'music_source_identity_conflicts',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sourceKey: text('source_key')
      .notNull()
      .references(() => musicSourceIdentitiesTable.sourceKey, { onDelete: 'cascade' }),
    incumbentEntityType: text('incumbent_entity_type')
      .notNull()
      .references(() => musicEntityTypesTable.id),
    incumbentEntityId: text('incumbent_entity_id').notNull(),
    candidateEntityType: text('candidate_entity_type')
      .notNull()
      .references(() => musicEntityTypesTable.id),
    candidateEntityId: text('candidate_entity_id').notNull(),
    reason: text().notNull(),
    status: text().$type<MusicSourceConflictStatus>().notNull().default('open'),
    detectedAt: integer('detected_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('music_source_identity_conflicts_open_uq')
      .on(
        table.sourceKey,
        table.incumbentEntityType,
        table.incumbentEntityId,
        table.candidateEntityType,
        table.candidateEntityId,
      )
      .where(sql`${table.status} = 'open'`),
    check(
      'music_source_identity_conflicts_status_check',
      sql`${table.status} IN ('open', 'resolved', 'ignored')`,
    ),
    index('music_source_identity_conflicts_audit_page_idx').on(
      table.status,
      table.detectedAt,
      table.id,
    ),
  ],
)

export const musicIdentityMaintenanceRunsTable = sqliteTable(
  'music_identity_maintenance_runs',
  {
    generationId: text('generation_id').primaryKey(),
    operation: text().notNull(),
    phase: text().notNull(),
    active: integer({ mode: 'boolean' }).notNull().default(true),
    linkHighWaterCreatedAt: integer('link_high_water_created_at', {
      mode: 'timestamp_ms',
    }).notNull(),
    linkHighWaterId: text('link_high_water_id').notNull(),
    claimHighWaterUpdatedAt: integer('claim_high_water_updated_at', {
      mode: 'timestamp_ms',
    }).notNull(),
    claimHighWaterEntityType: text('claim_high_water_entity_type').notNull(),
    claimHighWaterCanonicalUrl: text('claim_high_water_canonical_url').notNull(),
    cursorCreatedAt: integer('cursor_created_at', { mode: 'timestamp_ms' }).notNull(),
    cursorId: text('cursor_id').notNull(),
    claimCursorUpdatedAt: integer('claim_cursor_updated_at', {
      mode: 'timestamp_ms',
    }).notNull(),
    claimCursorEntityType: text('claim_cursor_entity_type').notNull(),
    claimCursorCanonicalUrl: text('claim_cursor_canonical_url').notNull(),
    applyCursorSourceKey: text('apply_cursor_source_key').notNull(),
    scannedCount: integer('scanned_count').notNull().default(0),
    candidateCount: integer('candidate_count').notNull().default(0),
    attemptedCount: integer('attempted_count').notNull().default(0),
    invalidCount: integer('invalid_count').notNull().default(0),
    orphanCount: integer('orphan_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('music_identity_maintenance_runs_active_uq')
      .on(table.operation)
      .where(sql`${table.active} = 1`),
  ],
)

export const musicIdentityMaintenanceCandidatesTable = sqliteTable(
  'music_identity_maintenance_candidates',
  {
    generationId: text('generation_id')
      .notNull()
      .references(() => musicIdentityMaintenanceRunsTable.generationId, {
        onDelete: 'cascade',
      }),
    sourceKey: text('source_key').notNull(),
    origin: text().notNull(),
    originKey: text('origin_key').notNull(),
    platform: text().notNull(),
    sourceEntityType: text('source_entity_type').notNull(),
    externalId: text('external_id'),
    canonicalUrl: text('canonical_url').notNull(),
    sourceUrl: text('source_url').notNull(),
    normalizedUrl: text('normalized_url').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    status: text().notNull(),
    verifiedAt: integer('verified_at', { mode: 'timestamp_ms' }),
    scrapedAt: integer('scraped_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.generationId, table.origin, table.originKey] }),
    index('music_identity_maintenance_candidates_source_page_idx').on(
      table.generationId,
      table.sourceKey,
      table.origin,
      table.originKey,
    ),
  ],
)

export const musicIdentityMaintenanceSourceKeysTable = sqliteTable(
  'music_identity_maintenance_source_keys',
  {
    generationId: text('generation_id')
      .notNull()
      .references(() => musicIdentityMaintenanceRunsTable.generationId, {
        onDelete: 'cascade',
      }),
    sourceKey: text('source_key').notNull(),
  },
  (table) => [primaryKey({ columns: [table.generationId, table.sourceKey] })],
)

export const musicIdentityMaintenanceFindingsTable = sqliteTable(
  'music_identity_maintenance_findings',
  {
    generationId: text('generation_id')
      .notNull()
      .references(() => musicIdentityMaintenanceRunsTable.generationId, {
        onDelete: 'cascade',
      }),
    findingKey: text('finding_key').notNull(),
    category: text().notNull(),
    sourceKey: text('source_key'),
    originKey: text('origin_key'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    detail: text().notNull(),
    detectedAt: integer('detected_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.generationId, table.findingKey] }),
    index('music_identity_maintenance_findings_page_idx').on(
      table.generationId,
      table.category,
      table.findingKey,
    ),
  ],
)

export const musicIdentityMaintenanceActionsTable = sqliteTable(
  'music_identity_maintenance_actions',
  {
    generationId: text('generation_id')
      .notNull()
      .references(() => musicIdentityMaintenanceRunsTable.generationId, {
        onDelete: 'cascade',
      }),
    actionKey: text('action_key').notNull(),
    kind: text().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.generationId, table.actionKey] }),
    index('music_identity_maintenance_actions_kind_idx').on(table.generationId, table.kind),
  ],
)

export const musicEntityResolutionClaimsTable = sqliteTable(
  'music_entity_resolution_claims',
  {
    entityType: text('entity_type')
      .notNull()
      .references(() => musicEntityTypesTable.id),
    canonicalUrl: text('canonical_url').notNull(),
    entityId: text('entity_id'),
    ownerToken: text('owner_token'),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.entityType, table.canonicalUrl] }),
    index('music_entity_resolution_claims_backfill_page_idx')
      .on(table.updatedAt, table.entityType, table.canonicalUrl)
      .where(sql`${table.entityId} IS NOT NULL`),
  ],
)

// ---------------------------------------------------------------------------
// TypeScript types
// ---------------------------------------------------------------------------

export type SelectMusicEntityType = InferSelectModel<typeof musicEntityTypesTable>

export type SelectMusicPlatform = InferSelectModel<typeof musicPlatformsTable>

export type SelectMusicArtist = InferSelectModel<typeof musicArtistsTable> & {
  genres: Array<string> | null
}

export type InsertMusicArtist = InferInsertModel<typeof musicArtistsTable>

export type SelectMusicAlbum = InferSelectModel<typeof musicAlbumsTable> & {
  genres: Array<string> | null
}

export type InsertMusicAlbum = InferInsertModel<typeof musicAlbumsTable>

export type SelectMusicTrack = InferSelectModel<typeof musicTracksTable>

export type InsertMusicTrack = InferInsertModel<typeof musicTracksTable>

export type SelectMusicPlaylist = InferSelectModel<typeof musicPlaylistsTable>

export type InsertMusicPlaylist = InferInsertModel<typeof musicPlaylistsTable>

export type SelectMusicLabel = InferSelectModel<typeof musicLabelsTable> & {
  tags: Array<string> | null
  genres: Array<string> | null
}

export type InsertMusicLabel = InferInsertModel<typeof musicLabelsTable>

export type SelectMdxCompiledMusicLabel = SelectMusicLabel & {
  compiledContent: string
  richContent: RichContentDocument
  creators: Array<{ id: string; name: string }>
}

export type SelectMusicPlaylistTrack = InferSelectModel<typeof musicPlaylistTracksTable>

export type InsertMusicPlaylistTrack = InferInsertModel<typeof musicPlaylistTracksTable>

export type SelectMusicEntityLink = InferSelectModel<typeof musicEntityLinksTable>

export type InsertMusicEntityLink = InferInsertModel<typeof musicEntityLinksTable>

export type SelectMusicEntityResolutionClaim = InferSelectModel<
  typeof musicEntityResolutionClaimsTable
>

export type SelectMusicIdentityMaintenanceRun = InferSelectModel<
  typeof musicIdentityMaintenanceRunsTable
>

export type SelectMusicSourceIdentity = InferSelectModel<typeof musicSourceIdentitiesTable>

export type InsertMusicSourceIdentity = InferInsertModel<typeof musicSourceIdentitiesTable>

export type SelectMusicSourceAlias = InferSelectModel<typeof musicSourceAliasesTable>

export type InsertMusicSourceAlias = InferInsertModel<typeof musicSourceAliasesTable>

export type SelectMusicSourceIdentityConflict = InferSelectModel<
  typeof musicSourceIdentityConflictsTable
>

export type InsertMusicSourceIdentityConflict = InferInsertModel<
  typeof musicSourceIdentityConflictsTable
>

// ---------------------------------------------------------------------------
// Drizzle relations
// ---------------------------------------------------------------------------

export const musicArtistsRelations = relations(musicArtistsTable, ({ many }) => ({
  albumArtists: many(musicAlbumArtistsTable),
  trackArtists: many(musicTrackArtistsTable),
  labelArtists: many(musicLabelArtistsTable),
}))

export const musicAlbumsRelations = relations(musicAlbumsTable, ({ many }) => ({
  albumArtists: many(musicAlbumArtistsTable),
  tracks: many(musicTracksTable),
  labelAlbums: many(musicLabelAlbumsTable),
}))

export const musicTracksRelations = relations(musicTracksTable, ({ one, many }) => ({
  album: one(musicAlbumsTable, {
    fields: [musicTracksTable.albumId],
    references: [musicAlbumsTable.id],
  }),
  trackArtists: many(musicTrackArtistsTable),
  playlistTracks: many(musicPlaylistTracksTable),
}))

export const musicAlbumArtistsRelations = relations(musicAlbumArtistsTable, ({ one }) => ({
  album: one(musicAlbumsTable, {
    fields: [musicAlbumArtistsTable.albumId],
    references: [musicAlbumsTable.id],
  }),
  artist: one(musicArtistsTable, {
    fields: [musicAlbumArtistsTable.artistId],
    references: [musicArtistsTable.id],
  }),
}))

export const musicTrackArtistsRelations = relations(musicTrackArtistsTable, ({ one }) => ({
  track: one(musicTracksTable, {
    fields: [musicTrackArtistsTable.trackId],
    references: [musicTracksTable.id],
  }),
  artist: one(musicArtistsTable, {
    fields: [musicTrackArtistsTable.artistId],
    references: [musicArtistsTable.id],
  }),
}))

export const musicPlaylistsRelations = relations(musicPlaylistsTable, ({ one, many }) => ({
  curator: one(user, {
    fields: [musicPlaylistsTable.curatorId],
    references: [user.id],
  }),
  playlistTracks: many(musicPlaylistTracksTable),
}))

export const musicLabelsRelations = relations(musicLabelsTable, ({ many }) => ({
  creators: many(musicLabelCreatorsTable),
  artists: many(musicLabelArtistsTable),
  albums: many(musicLabelAlbumsTable),
}))

export const musicLabelCreatorsRelations = relations(musicLabelCreatorsTable, ({ one }) => ({
  label: one(musicLabelsTable, {
    fields: [musicLabelCreatorsTable.labelId],
    references: [musicLabelsTable.id],
  }),
  creator: one(user, {
    fields: [musicLabelCreatorsTable.creatorId],
    references: [user.id],
  }),
}))

export const musicLabelArtistsRelations = relations(musicLabelArtistsTable, ({ one }) => ({
  label: one(musicLabelsTable, {
    fields: [musicLabelArtistsTable.labelId],
    references: [musicLabelsTable.id],
  }),
  artist: one(musicArtistsTable, {
    fields: [musicLabelArtistsTable.artistId],
    references: [musicArtistsTable.id],
  }),
}))

export const musicLabelAlbumsRelations = relations(musicLabelAlbumsTable, ({ one }) => ({
  label: one(musicLabelsTable, {
    fields: [musicLabelAlbumsTable.labelId],
    references: [musicLabelsTable.id],
  }),
  album: one(musicAlbumsTable, {
    fields: [musicLabelAlbumsTable.albumId],
    references: [musicAlbumsTable.id],
  }),
}))

export const musicPlaylistTracksRelations = relations(musicPlaylistTracksTable, ({ one }) => ({
  playlist: one(musicPlaylistsTable, {
    fields: [musicPlaylistTracksTable.playlistId],
    references: [musicPlaylistsTable.id],
  }),
  track: one(musicTracksTable, {
    fields: [musicPlaylistTracksTable.trackId],
    references: [musicTracksTable.id],
  }),
}))
