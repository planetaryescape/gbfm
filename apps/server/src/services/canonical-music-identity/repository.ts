import { LINK_STATUS } from '@gbfm/core/status'
import { and, eq, inArray, lt, or } from 'drizzle-orm'
import { Data, Effect } from 'effect'

import type { DatabaseClient } from '@/db/layer'
import {
  musicAlbumsTable,
  musicArtistsTable,
  musicEntityLinksTable,
  musicPlaylistsTable,
  musicSourceAliasesTable,
  musicSourceIdentitiesTable,
  musicSourceIdentityConflictsTable,
  musicTracksTable,
  type SelectMusicSourceIdentity,
} from '@/db/music-entity.schema'
import { getErrorMessage } from '@/errors'
import type { ScrapedLink } from '@/services/music-link-scraper.service'

import { MusicIdentityAliasCollision, MusicIdentityStorageError } from './errors'
import type { CanonicalMusicEntityType, ParsedMusicSource } from './music-source'
import {
  aliasStatement,
  completionStatement,
  entityExistenceGuard,
  entityInsertStatements,
  existingEntityLinkStatement,
  linkStatement,
  type WriteFence,
  writeFenceGuard,
} from './repository-statements'

export type EntityReference = {
  readonly entityType: CanonicalMusicEntityType
  readonly entityId: string
}

export type EntityArtist = {
  readonly id: string
  readonly name: string
  readonly slug?: string
  readonly isNew: boolean
}

export type EntityRecord = {
  readonly entityType: CanonicalMusicEntityType
  readonly entityId: string
  readonly title: string
  readonly artistNames: ReadonlyArray<string>
  readonly artists: ReadonlyArray<EntityArtist>
  readonly imageUrl?: string | undefined
  readonly description?: string | undefined
  readonly trackNumber?: number | undefined
  readonly curatorId?: string | null | undefined
}

export type ClaimResult =
  | { readonly _tag: 'owned'; readonly result: 'miss' | 'reclaimed'; readonly claimAgeMs?: number }
  | { readonly _tag: 'resolved'; readonly reference: EntityReference }
  | { readonly _tag: 'busy'; readonly retryAfterMs: number; readonly claimAgeMs: number }

export const ClaimResult = Data.taggedEnum<ClaimResult>()

export type SettledClaim = Extract<ClaimResult, { readonly _tag: 'owned' | 'resolved' }>

const storageError = (operation: string, cause: unknown) =>
  new MusicIdentityStorageError({
    operation,
    message: getErrorMessage(cause),
  })

const unreachableEntityType = (entityType: never): never => {
  throw new Error(`Unexpected canonical music entity type: ${String(entityType)}`)
}

const resolvedReference = (identity: SelectMusicSourceIdentity): EntityReference | undefined => {
  if (
    identity.state !== 'resolved' ||
    !identity.entityId ||
    !identity.entityType ||
    !['artist', 'album', 'track', 'playlist'].includes(identity.entityType)
  ) {
    return undefined
  }

  const entityType = identity.entityType

  if (
    entityType === 'artist' ||
    entityType === 'album' ||
    entityType === 'track' ||
    entityType === 'playlist'
  ) {
    return { entityType, entityId: identity.entityId }
  }

  return undefined
}

export class CanonicalMusicIdentityRepository {
  constructor(private readonly db: DatabaseClient) {}

  readonly lookup = (source: ParsedMusicSource) =>
    Effect.tryPromise({
      try: async () => {
        const aliases = await this.db
          .select({ identity: musicSourceIdentitiesTable })
          .from(musicSourceAliasesTable)
          .innerJoin(
            musicSourceIdentitiesTable,
            eq(musicSourceAliasesTable.sourceKey, musicSourceIdentitiesTable.sourceKey),
          )
          .where(eq(musicSourceAliasesTable.normalizedUrl, source.normalizedUrl))
          .limit(1)

        const aliasIdentity = aliases[0]?.identity

        if (aliasIdentity) return { aliasIdentity }

        const identities = await this.db
          .select()
          .from(musicSourceIdentitiesTable)
          .where(eq(musicSourceIdentitiesTable.sourceKey, source.sourceKey))
          .limit(1)

        return { identity: identities[0] }
      },
      catch: (cause) => storageError('lookup', cause),
    }).pipe(
      Effect.flatMap(({ aliasIdentity, identity }) =>
        aliasIdentity && aliasIdentity.sourceKey !== source.sourceKey
          ? Effect.fail(
              new MusicIdentityAliasCollision({
                normalizedUrl: source.normalizedUrl,
                expectedSourceKey: source.sourceKey,
                storedSourceKey: aliasIdentity.sourceKey,
              }),
            )
          : Effect.succeed(aliasIdentity ?? identity),
      ),
    )

  readonly claim = (
    source: ParsedMusicSource,
    ownerToken: string,
    now: Date,
    leaseMs: number,
  ): Effect.Effect<ClaimResult, MusicIdentityStorageError> =>
    Effect.tryPromise({
      try: async () => {
        const leaseExpiresAt = new Date(now.getTime() + leaseMs)

        const inserted = await this.db
          .insert(musicSourceIdentitiesTable)
          .values({
            sourceKey: source.sourceKey,
            platform: source.platform,
            sourceEntityType: source.sourceEntityType,
            externalId: source.externalId,
            canonicalUrl: source.canonicalUrl,
            state: 'resolving',
            ownerToken,
            leaseExpiresAt,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ sourceKey: musicSourceIdentitiesTable.sourceKey })

        if (inserted.length > 0) return ClaimResult.owned({ result: 'miss' })

        const reclaimed = await this.db
          .update(musicSourceIdentitiesTable)
          .set({ ownerToken, leaseExpiresAt, updatedAt: now })
          .where(
            and(
              eq(musicSourceIdentitiesTable.sourceKey, source.sourceKey),
              eq(musicSourceIdentitiesTable.state, 'resolving'),
              lt(musicSourceIdentitiesTable.leaseExpiresAt, now),
            ),
          )
          .returning()

        const reclaimedIdentity = reclaimed[0]

        if (reclaimedIdentity) {
          return ClaimResult.owned({
            result: 'reclaimed',
            claimAgeMs: Math.max(0, now.getTime() - reclaimedIdentity.createdAt.getTime()),
          })
        }

        const rows = await this.db
          .select()
          .from(musicSourceIdentitiesTable)
          .where(eq(musicSourceIdentitiesTable.sourceKey, source.sourceKey))
          .limit(1)

        const identity = rows[0]

        if (!identity) {
          return ClaimResult.busy({ retryAfterMs: leaseMs, claimAgeMs: 0 })
        }

        const reference = resolvedReference(identity)

        if (reference) return ClaimResult.resolved({ reference })

        const retryAfterMs = Math.max(
          1,
          (identity.leaseExpiresAt?.getTime() ?? now.getTime() + leaseMs) - now.getTime(),
        )

        return ClaimResult.busy({
          retryAfterMs,
          claimAgeMs: Math.max(0, now.getTime() - identity.createdAt.getTime()),
        })
      },
      catch: (cause) => storageError('claim', cause),
    })

  readonly renew = (
    sourceKeys: ReadonlyArray<string>,
    ownerToken: string,
    now: Date,
    leaseMs: number,
  ) =>
    Effect.tryPromise({
      try: () =>
        this.db
          .update(musicSourceIdentitiesTable)
          .set({ leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now })
          .where(
            and(
              inArray(musicSourceIdentitiesTable.sourceKey, sourceKeys),
              eq(musicSourceIdentitiesTable.state, 'resolving'),
              eq(musicSourceIdentitiesTable.ownerToken, ownerToken),
            ),
          )
          .returning({ sourceKey: musicSourceIdentitiesTable.sourceKey }),
      catch: (cause) => storageError('renew', cause),
    })

  readonly release = (sourceKeys: ReadonlyArray<string>, ownerToken: string) => {
    if (sourceKeys.length === 0) return Effect.void

    return Effect.tryPromise({
      try: () =>
        this.db
          .delete(musicSourceIdentitiesTable)
          .where(
            and(
              inArray(musicSourceIdentitiesTable.sourceKey, sourceKeys),
              eq(musicSourceIdentitiesTable.state, 'resolving'),
              eq(musicSourceIdentitiesTable.ownerToken, ownerToken),
            ),
          ),
      catch: (cause) => storageError('release', cause),
    })
  }

  readonly removeOrphan = (reference: EntityReference) =>
    Effect.tryPromise({
      try: () =>
        this.db
          .delete(musicSourceIdentitiesTable)
          .where(
            and(
              eq(musicSourceIdentitiesTable.state, 'resolved'),
              eq(musicSourceIdentitiesTable.entityType, reference.entityType),
              eq(musicSourceIdentitiesTable.entityId, reference.entityId),
            ),
          ),
      catch: (cause) => storageError('removeOrphan', cause),
    })

  readonly touchAlias = (source: ParsedMusicSource, reference: EntityReference, now: Date) =>
    Effect.flatMap(this.lookup(source), () =>
      Effect.tryPromise({
        try: () => {
          const target = entityExistenceGuard(reference)

          return this.db.$client
            .prepare(`INSERT INTO music_source_aliases (
              normalized_url, source_key, first_seen_at, last_seen_at
            ) SELECT ?, ?, ?, ? WHERE ${target.sql}
              ON CONFLICT(normalized_url) DO UPDATE SET last_seen_at = excluded.last_seen_at
                WHERE source_key = excluded.source_key`)
            .bind(
              source.normalizedUrl,
              source.sourceKey,
              now.getTime(),
              now.getTime(),
              ...target.values,
            )
            .run()
        },
        catch: (cause) => storageError('touchAlias', cause),
      }),
    )

  readonly legacyCandidates = (source: ParsedMusicSource, entityType: CanonicalMusicEntityType) =>
    Effect.tryPromise({
      try: () =>
        this.db
          .select()
          .from(musicEntityLinksTable)
          .where(
            and(
              eq(musicEntityLinksTable.entityType, entityType),
              source.platform === 'other'
                ? or(
                    eq(musicEntityLinksTable.url, source.normalizedUrl),
                    eq(musicEntityLinksTable.url, source.canonicalUrl),
                  )
                : eq(musicEntityLinksTable.platform, source.platform),
            ),
          ),
      catch: (cause) => storageError('legacyCandidates', cause),
    })

  readonly linksFor = (reference: EntityReference) =>
    Effect.tryPromise({
      try: () =>
        this.db
          .select()
          .from(musicEntityLinksTable)
          .where(
            and(
              eq(musicEntityLinksTable.entityType, reference.entityType),
              eq(musicEntityLinksTable.entityId, reference.entityId),
            ),
          )
          .orderBy(musicEntityLinksTable.platform),
      catch: (cause) => storageError('linksFor', cause),
    })

  readonly linkById = (reference: EntityReference, linkId: string) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await this.db
          .select()
          .from(musicEntityLinksTable)
          .where(
            and(
              eq(musicEntityLinksTable.entityType, reference.entityType),
              eq(musicEntityLinksTable.entityId, reference.entityId),
              eq(musicEntityLinksTable.id, linkId),
            ),
          )
          .limit(1)

        return rows[0]
      },
      catch: (cause) => storageError('linkById', cause),
    })

  readonly releaseLink = (input: {
    readonly reference: EntityReference
    readonly linkId: string
    readonly source?: ParsedMusicSource
    readonly action: 'reject' | 'delete'
    readonly verifiedBy?: string
    readonly metadata?: ScrapedLink['metadata']
    readonly now: Date
  }) =>
    Effect.tryPromise({
      try: async () => {
        const statements: Array<D1PreparedStatement> = []

        if (input.source) {
          statements.push(
            this.db.$client
              .prepare(`DELETE FROM music_source_identities
                WHERE source_key = ? AND state = 'resolved' AND entity_type = ? AND entity_id = ?`)
              .bind(input.source.sourceKey, input.reference.entityType, input.reference.entityId),
          )
        }

        if (input.action === 'delete') {
          statements.push(
            this.db.$client
              .prepare(`DELETE FROM music_entity_links
                WHERE id = ? AND entity_type = ? AND entityId = ?`)
              .bind(input.linkId, input.reference.entityType, input.reference.entityId),
          )
        } else {
          statements.push(
            this.db.$client
              .prepare(`UPDATE music_entity_links
                SET status = 'rejected', verifiedBy = ?, metadata = ?, updatedAt = ?
                WHERE id = ? AND entity_type = ? AND entityId = ?`)
              .bind(
                input.verifiedBy ?? null,
                input.metadata ? JSON.stringify(input.metadata) : null,
                input.now.getTime(),
                input.linkId,
                input.reference.entityType,
                input.reference.entityId,
              ),
          )
        }

        await this.db.$client.batch(statements)

        if (input.action === 'delete') return undefined

        const rows = await this.db
          .select()
          .from(musicEntityLinksTable)
          .where(eq(musicEntityLinksTable.id, input.linkId))
          .limit(1)

        return rows[0]
      },
      catch: (cause) => storageError('releaseLink', cause),
    })

  readonly upsertLink = (reference: EntityReference, link: ScrapedLink, now: Date) =>
    Effect.tryPromise({
      try: async () => {
        const target = entityExistenceGuard(reference)

        const result = await this.db.$client
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
          .run()

        if ((result.meta.changes ?? 0) === 0) return []

        return this.db
          .select()
          .from(musicEntityLinksTable)
          .where(
            and(
              eq(musicEntityLinksTable.entityType, reference.entityType),
              eq(musicEntityLinksTable.entityId, reference.entityId),
              eq(musicEntityLinksTable.platform, link.platform),
            ),
          )
          .limit(1)
      },
      catch: (cause) => storageError('upsertLink', cause),
    })

  readonly commit = (input: {
    readonly ownedSources: ReadonlyArray<ParsedMusicSource>
    readonly allSources: ReadonlyArray<ParsedMusicSource>
    readonly reference: EntityReference
    readonly entity?: EntityRecord
    readonly slug?: string
    readonly links: ReadonlyArray<ScrapedLink>
    readonly ownerToken: string
    readonly scrapedAt: Date
    readonly now: Date
  }) =>
    Effect.tryPromise({
      try: async () => {
        if (input.ownedSources.length === 0) return true

        const fence: WriteFence = {
          ownedSources: input.ownedSources,
          aliases: input.allSources,
          ownerToken: input.ownerToken,
          reference: input.reference,
        }

        const statements: Array<D1PreparedStatement> = []

        if (input.entity && input.slug) {
          statements.push(
            ...entityInsertStatements(this.db, input.entity, input.slug, fence, input.now),
          )
        }

        for (const link of input.links) {
          statements.push(linkStatement(this.db, input.reference, link, fence, input.now))
        }

        for (const source of input.allSources) {
          statements.push(aliasStatement(this.db, source, fence, input.now))
        }

        statements.push(completionStatement(this.db, fence, input.scrapedAt, input.now))
        const results = await this.db.$client.batch(statements)
        const completion = results.at(-1)

        return (completion?.meta.changes ?? 0) === input.ownedSources.length
      },
      catch: (cause) => storageError('commit', cause),
    })

  readonly updateArtwork = (reference: EntityReference, artworkUrl: string) =>
    Effect.tryPromise({
      try: () => {
        const updatedAt = new Date()

        switch (reference.entityType) {
          case 'artist':
            return this.db
              .update(musicArtistsTable)
              .set({ imageUrl: artworkUrl, updatedAt })
              .where(eq(musicArtistsTable.id, reference.entityId))
          case 'album':
            return this.db
              .update(musicAlbumsTable)
              .set({ coverImageUrl: artworkUrl, updatedAt })
              .where(eq(musicAlbumsTable.id, reference.entityId))
          case 'track':
            return this.db
              .update(musicTracksTable)
              .set({ coverImageUrl: artworkUrl, updatedAt })
              .where(eq(musicTracksTable.id, reference.entityId))
          case 'playlist':
            return this.db
              .update(musicPlaylistsTable)
              .set({ coverImageUrl: artworkUrl, updatedAt })
              .where(eq(musicPlaylistsTable.id, reference.entityId))
          default:
            return unreachableEntityType(reference.entityType)
        }
      },
      catch: (cause) => storageError('updateArtwork', cause),
    })

  readonly recordConflict = (
    sourceKey: string,
    incumbent: EntityReference,
    candidate: EntityReference,
    reason: string,
    now: Date,
  ) =>
    Effect.tryPromise({
      try: () =>
        this.db
          .insert(musicSourceIdentityConflictsTable)
          .values({
            id: crypto.randomUUID(),
            sourceKey,
            incumbentEntityType: incumbent.entityType,
            incumbentEntityId: incumbent.entityId,
            candidateEntityType: candidate.entityType,
            candidateEntityId: candidate.entityId,
            reason,
            detectedAt: now,
          })
          .onConflictDoNothing(),
      catch: (cause) => storageError('recordConflict', cause),
    })

  readonly updateEntityMetadata = (input: {
    readonly entity: EntityRecord
    readonly links: ReadonlyArray<ScrapedLink>
    readonly sources: ReadonlyArray<ParsedMusicSource>
    readonly ownedSources: ReadonlyArray<ParsedMusicSource>
    readonly ownerToken: string
    readonly now: Date
  }): Effect.Effect<boolean, MusicIdentityStorageError> =>
    Effect.tryPromise({
      try: async () => {
        const { entity, links, sources, ownedSources, ownerToken, now } = input
        const reference: EntityReference = entity

        const fence: WriteFence | undefined =
          ownedSources.length > 0
            ? { ownedSources, aliases: sources, ownerToken, reference }
            : undefined

        const guard = fence ? writeFenceGuard(fence, true) : entityExistenceGuard(reference)
        const statements: Array<D1PreparedStatement> = []

        const artistNames =
          entity.artistNames.length > 0 ? JSON.stringify(entity.artistNames) : null

        switch (entity.entityType) {
          case 'artist':
            statements.push(
              this.db.$client
                .prepare(`UPDATE music_artists SET name = ?, imageUrl = ?, updatedAt = ?
                  WHERE id = ? AND ${guard.sql}`)
                .bind(
                  entity.title,
                  entity.imageUrl ?? null,
                  now.getTime(),
                  entity.entityId,
                  ...guard.values,
                ),
            )
            break
          case 'album':
            statements.push(
              this.db.$client
                .prepare(`UPDATE music_albums SET title = ?, artistNames = ?, coverImageUrl = ?, updatedAt = ?
                  WHERE id = ? AND ${guard.sql}`)
                .bind(
                  entity.title,
                  artistNames,
                  entity.imageUrl ?? null,
                  now.getTime(),
                  entity.entityId,
                  ...guard.values,
                ),
            )
            break
          case 'track':
            statements.push(
              this.db.$client
                .prepare(`UPDATE music_tracks SET title = ?, artistNames = ?, coverImageUrl = ?, updatedAt = ?
                  WHERE id = ? AND ${guard.sql}`)
                .bind(
                  entity.title,
                  artistNames,
                  entity.imageUrl ?? null,
                  now.getTime(),
                  entity.entityId,
                  ...guard.values,
                ),
            )
            break
          case 'playlist':
            statements.push(
              this.db.$client
                .prepare(`UPDATE music_playlists SET title = ?, description = ?, coverImageUrl = ?, updatedAt = ?
                  WHERE id = ? AND ${guard.sql}`)
                .bind(
                  entity.title,
                  entity.description ?? null,
                  entity.imageUrl ?? null,
                  now.getTime(),
                  entity.entityId,
                  ...guard.values,
                ),
            )
            break
        }

        for (const link of links) {
          statements.push(
            fence
              ? linkStatement(this.db, reference, link, fence, now)
              : existingEntityLinkStatement(this.db, reference, link, now),
          )
        }

        if (fence) {
          for (const source of sources) {
            statements.push(aliasStatement(this.db, source, fence, now))
          }
        }

        for (const source of sources) {
          statements.push(
            this.db.$client
              .prepare(`UPDATE music_source_identities SET last_scraped_at = ?, updated_at = ?
                WHERE source_key = ? AND state = 'resolved' AND entity_type = ?
                  AND entity_id = ? AND ${guard.sql}`)
              .bind(
                now.getTime(),
                now.getTime(),
                source.sourceKey,
                entity.entityType,
                entity.entityId,
                ...guard.values,
              ),
          )
        }

        if (fence) statements.push(completionStatement(this.db, fence, now, now))
        const results = await this.db.$client.batch(statements)

        if (!fence) return (results[0]?.meta.changes ?? 0) > 0

        return (results.at(-1)?.meta.changes ?? 0) === ownedSources.length
      },
      catch: (cause) => storageError('refresh', cause),
    })
}

export const asResolvedReference = resolvedReference
