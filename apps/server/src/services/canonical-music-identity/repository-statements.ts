import { LINK_STATUS } from '@gbfm/core/status'
import type { SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { Schema } from 'effect'

import type { DatabaseClient } from '@/db/layer'
import type { ScrapedLink } from '@/services/music-link-scraper.service'

import type { ParsedMusicSource } from './music-source'
import type { EntityRecord, EntityReference } from './repository'

const unreachable = (value: never): never => {
  throw new Error(`Unexpected canonical music entity type: ${String(value)}`)
}

export type WriteFence = {
  readonly ownedSources: ReadonlyArray<ParsedMusicSource>
  readonly aliases: ReadonlyArray<ParsedMusicSource>
  readonly ownerToken: string
  readonly reference: EntityReference
  readonly additionalGuard?: SQL | undefined
  readonly preserveLinks?: boolean
}

const entityTable = (entityType: EntityReference['entityType']) => {
  switch (entityType) {
    case 'artist':
      return 'music_artists'
    case 'album':
      return 'music_albums'
    case 'track':
      return 'music_tracks'
    case 'playlist':
      return 'music_playlists'
    default:
      return unreachable(entityType)
  }
}

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ')

const ownershipGuard = (fence: WriteFence) => {
  const additional = fence.additionalGuard
    ? new SQLiteSyncDialect().sqlToQuery(fence.additionalGuard)
    : { sql: '1', params: [] }

  const values = Schema.decodeUnknownSync(
    Schema.Array(Schema.Union([Schema.String, Schema.Number, Schema.Null])),
  )(additional.params)

  const aliasGuards = fence.aliases.map(
    () =>
      `NOT EXISTS (SELECT 1 FROM music_source_aliases
        WHERE normalized_url = ? AND source_key <> ?)`,
  )

  return {
    sql: [
      `(SELECT COUNT(*) FROM music_source_identities
        WHERE state = 'resolving' AND owner_token = ?
          AND source_key IN (${placeholders(fence.ownedSources.length)})) = ?`,
      ...aliasGuards,
      `(${additional.sql})`,
    ].join(' AND '),
    values: [
      fence.ownerToken,
      ...fence.ownedSources.map((source) => source.sourceKey),
      fence.ownedSources.length,
      ...fence.aliases.flatMap((source) => [source.normalizedUrl, source.sourceKey]),
      ...values,
    ],
  }
}

const targetGuard = (fence: WriteFence) => ({
  sql: `EXISTS (SELECT 1 FROM ${entityTable(fence.reference.entityType)} WHERE id = ?)`,
  values: [fence.reference.entityId],
})

export const writeFenceGuard = (fence: WriteFence, requireTarget: boolean) => {
  const ownership = ownershipGuard(fence)

  if (!requireTarget) return ownership
  const target = targetGuard(fence)

  return {
    sql: `${ownership.sql} AND ${target.sql}`,
    values: [...ownership.values, ...target.values],
  }
}

const newArtistStatements = (
  db: DatabaseClient,
  entity: EntityRecord,
  fence: WriteFence,
  now: Date,
) => {
  const guard = writeFenceGuard(fence, false)

  return entity.artists.flatMap((artist) =>
    artist.isNew && artist.slug
      ? [
          db.$client
            .prepare(`INSERT INTO music_artists (id, name, slug, createdAt, updatedAt)
              SELECT ?, ?, ?, ?, ? WHERE ${guard.sql}`)
            .bind(
              artist.id,
              artist.name,
              artist.slug,
              now.getTime(),
              now.getTime(),
              ...guard.values,
            ),
        ]
      : [],
  )
}

const primaryEntityStatement = (
  db: DatabaseClient,
  entity: EntityRecord,
  slug: string,
  fence: WriteFence,
  now: Date,
) => {
  const guard = writeFenceGuard(fence, false)
  const artistNames = entity.artistNames.length > 0 ? JSON.stringify(entity.artistNames) : null

  switch (entity.entityType) {
    case 'artist':
      return db.$client
        .prepare(`INSERT INTO music_artists (id, name, imageUrl, slug, createdAt, updatedAt)
          SELECT ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`)
        .bind(
          entity.entityId,
          entity.title,
          entity.imageUrl ?? null,
          slug,
          now.getTime(),
          now.getTime(),
          ...guard.values,
        )
    case 'album':
      return db.$client
        .prepare(`INSERT INTO music_albums (id, title, artistNames, coverImageUrl, slug, createdAt, updatedAt)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`)
        .bind(
          entity.entityId,
          entity.title,
          artistNames,
          entity.imageUrl ?? null,
          slug,
          now.getTime(),
          now.getTime(),
          ...guard.values,
        )
    case 'track':
      return db.$client
        .prepare(`INSERT INTO music_tracks (
          id, title, artistNames, coverImageUrl, trackNumber, slug, createdAt, updatedAt
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`)
        .bind(
          entity.entityId,
          entity.title,
          artistNames,
          entity.imageUrl ?? null,
          entity.trackNumber ?? null,
          slug,
          now.getTime(),
          now.getTime(),
          ...guard.values,
        )
    case 'playlist':
      return db.$client
        .prepare(`INSERT INTO music_playlists (
          id, title, description, coverImageUrl, curatorId, slug, createdAt, updatedAt
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`)
        .bind(
          entity.entityId,
          entity.title,
          entity.description ?? null,
          entity.imageUrl ?? null,
          entity.curatorId ?? null,
          slug,
          now.getTime(),
          now.getTime(),
          ...guard.values,
        )
    default:
      return unreachable(entity.entityType)
  }
}

const relationStatements = (db: DatabaseClient, entity: EntityRecord, fence: WriteFence) => {
  if (entity.entityType !== 'album' && entity.entityType !== 'track') return []
  const guard = writeFenceGuard(fence, true)
  const table = entity.entityType === 'album' ? 'music_album_artists' : 'music_track_artists'
  const entityColumn = entity.entityType === 'album' ? 'albumId' : 'trackId'

  return entity.artists.map((artist, displayOrder) =>
    db.$client
      .prepare(`INSERT INTO ${table} (${entityColumn}, artistId, displayOrder)
        SELECT ?, ?, ? WHERE ${guard.sql}
          AND EXISTS (SELECT 1 FROM music_artists WHERE id = ?)`)
      .bind(entity.entityId, artist.id, displayOrder, ...guard.values, artist.id),
  )
}

export const entityInsertStatements = (
  db: DatabaseClient,
  entity: EntityRecord,
  slug: string,
  fence: WriteFence,
  now: Date,
) => [
  ...newArtistStatements(db, entity, fence, now),
  primaryEntityStatement(db, entity, slug, fence, now),
  ...relationStatements(db, entity, fence),
]

export const linkStatement = (
  db: DatabaseClient,
  reference: EntityReference,
  link: ScrapedLink,
  fence: WriteFence,
  now: Date,
) => {
  const guard = writeFenceGuard(fence, true)

  return db.$client
    .prepare(`INSERT INTO music_entity_links (
      id, entity_type, entityId, platform, url, status, scrapedAt, verifiedAt, metadata, createdAt, updatedAt
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}
    ON CONFLICT(entity_type, entityId, platform) ${
      fence.preserveLinks
        ? 'DO NOTHING'
        : `DO UPDATE SET
      url = excluded.url, status = excluded.status, scrapedAt = excluded.scrapedAt,
      verifiedAt = excluded.verifiedAt, metadata = excluded.metadata, updatedAt = excluded.updatedAt`
    }`)
    .bind(
      crypto.randomUUID(),
      reference.entityType,
      reference.entityId,
      link.platform,
      link.url,
      LINK_STATUS.VERIFIED,
      link.scrapedAt.getTime(),
      link.scrapedAt.getTime(),
      link.metadata ? JSON.stringify(link.metadata) : null,
      now.getTime(),
      now.getTime(),
      ...guard.values,
    )
}

export const aliasStatement = (
  db: DatabaseClient,
  source: ParsedMusicSource,
  fence: WriteFence,
  now: Date,
) => {
  const guard = writeFenceGuard(fence, true)

  return db.$client
    .prepare(`INSERT INTO music_source_aliases (normalized_url, source_key, first_seen_at, last_seen_at)
      SELECT ?, ?, ?, ? WHERE ${guard.sql}
      ON CONFLICT(normalized_url) DO UPDATE SET last_seen_at = excluded.last_seen_at
        WHERE source_key = excluded.source_key`)
    .bind(source.normalizedUrl, source.sourceKey, now.getTime(), now.getTime(), ...guard.values)
}

export const completionStatement = (
  db: DatabaseClient,
  fence: WriteFence,
  scrapedAt: Date,
  now: Date,
) => {
  const guard = writeFenceGuard(fence, true)

  return db.$client
    .prepare(`UPDATE music_source_identities SET
      state = 'resolved', entity_type = ?, entity_id = ?, owner_token = NULL,
      lease_expires_at = NULL, resolved_at = ?, last_scraped_at = ?, updated_at = ?
      WHERE source_key IN (${placeholders(fence.ownedSources.length)})
        AND state = 'resolving' AND owner_token = ? AND ${guard.sql}`)
    .bind(
      fence.reference.entityType,
      fence.reference.entityId,
      now.getTime(),
      scrapedAt.getTime(),
      now.getTime(),
      ...fence.ownedSources.map((source) => source.sourceKey),
      fence.ownerToken,
      ...guard.values,
    )
}

export const entityExistenceGuard = (reference: EntityReference) => ({
  sql: `EXISTS (SELECT 1 FROM ${entityTable(reference.entityType)} WHERE id = ?)`,
  values: [reference.entityId],
})

export const existingEntityLinkStatement = (
  db: DatabaseClient,
  reference: EntityReference,
  link: ScrapedLink,
  now: Date,
) => {
  const target = entityExistenceGuard(reference)

  return db.$client
    .prepare(`INSERT INTO music_entity_links (
      id, entity_type, entityId, platform, url, status, scrapedAt, verifiedAt, metadata, createdAt, updatedAt
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${target.sql}
    ON CONFLICT(entity_type, entityId, platform) DO UPDATE SET
      url = excluded.url, status = excluded.status, scrapedAt = excluded.scrapedAt,
      verifiedAt = excluded.verifiedAt, metadata = excluded.metadata, updatedAt = excluded.updatedAt`)
    .bind(
      crypto.randomUUID(),
      reference.entityType,
      reference.entityId,
      link.platform,
      link.url,
      LINK_STATUS.VERIFIED,
      link.scrapedAt.getTime(),
      link.scrapedAt.getTime(),
      link.metadata ? JSON.stringify(link.metadata) : null,
      now.getTime(),
      now.getTime(),
      ...target.values,
    )
}

export const deleteLinksStatement = (
  db: DatabaseClient,
  reference: EntityReference,
  fence?: WriteFence,
) => {
  const guard = fence ? writeFenceGuard(fence, true) : entityExistenceGuard(reference)

  return db.$client
    .prepare(`DELETE FROM music_entity_links
      WHERE entity_type = ? AND entityId = ? AND ${guard.sql}`)
    .bind(reference.entityType, reference.entityId, ...guard.values)
}
