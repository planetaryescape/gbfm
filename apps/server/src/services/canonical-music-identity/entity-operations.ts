import { Effect } from 'effect'

import type { DatabaseClient } from '@/db/layer'
import { Database } from '@/db/layer'
import type { MusicPlatform, SelectMusicEntityLink } from '@/db/music-entity.schema'
import { omitUndefined } from '@/lib/omit-undefined'
import type {
  MusicLinkScraperService,
  MusicScraperError,
  ScrapedLink,
} from '@/services/music-link-scraper.service'

import type {
  AnyResolvedMusicEntity,
  AttachMusicSourceLink,
  RefreshMusicEntity,
  ReleaseMusicSourceLink,
} from './contract'
import { loadEntity, loadResolvedEntity, refreshedEntityRecord } from './entity-record'
import {
  MusicIdentityBusy,
  MusicIdentityConflict,
  type MusicIdentityError,
  MusicIdentityInvalidSnapshot,
  type MusicIdentityProviderRejected,
  type MusicIdentityProviderUnavailable,
  MusicIdentitySourceLinkNotFound,
  MusicIdentityStorageError,
  MusicSourceInvalid,
} from './errors'
import { parseMusicSource, type ParsedMusicSource } from './music-source'
import {
  type CanonicalMusicIdentityRepository,
  ClaimResult,
  type EntityReference,
  type SettledClaim,
} from './repository'
import { parseDiscoveredSources, uniqueLinks } from './source-result'
import { annotateEntity, annotateSource, withSafeTypedSpan } from './telemetry'

type ReadReference = (
  source: ParsedMusicSource,
) => Effect.Effect<EntityReference | undefined, MusicIdentityError>

type ClaimWithWait = (
  source: ParsedMusicSource,
  ownerToken: string,
) => Effect.Effect<SettledClaim, MusicIdentityError>

const referenceKey = (reference: EntityReference) => `${reference.entityType}:${reference.entityId}`

const storageError = (operation: string, message: string) =>
  new MusicIdentityStorageError({ operation, message })

type RefreshMode = 'automatic_enrichment' | 'administrator_refresh'

type DeliverMusicArtwork = (input: {
  readonly resolved: AnyResolvedMusicEntity
  readonly candidateUrl: string | undefined | null
  readonly delivery: RefreshMusicEntity['artworkDelivery']
}) => Effect.Effect<AnyResolvedMusicEntity, MusicIdentityError>

const compareOptionalDate = (left: Date | null, right: Date | null) => {
  if (left === null) return right === null ? 0 : 1

  if (right === null) return -1

  return left.getTime() - right.getTime()
}

const compareRefreshSourcePrecedence = (
  left: SelectMusicEntityLink,
  right: SelectMusicEntityLink,
) =>
  compareOptionalDate(left.verifiedAt, right.verifiedAt) ||
  compareOptionalDate(left.scrapedAt, right.scrapedAt) ||
  left.createdAt.getTime() - right.createdAt.getTime() ||
  left.id.localeCompare(right.id)

const genericDisplayPlatforms = [
  'discord',
  'website',
  'instagram',
  'twitter',
  'musicbrainz',
  'discogs',
  'other',
] as const

const displayPlatformFor = (
  source: ParsedMusicSource,
  requestedPlatform: AttachMusicSourceLink['platform'],
): MusicPlatform | undefined => {
  if (source.platform === requestedPlatform) return source.platform

  if (source.platform === 'other') {
    return genericDisplayPlatforms.find((platform) => platform === requestedPlatform)
  }

  if (source.platform === 'youtube' && requestedPlatform === 'youtube_music') {
    return 'youtube_music'
  }

  return undefined
}

export const buildEntityOperations = (
  db: DatabaseClient,
  scraper: MusicLinkScraperService,
  repository: CanonicalMusicIdentityRepository,
  readReference: ReadReference,
  claimWithWait: ClaimWithWait,
  providerError: (
    error: MusicScraperError,
  ) => MusicIdentityProviderRejected | MusicIdentityProviderUnavailable,
  claimLeaseMs: number,
  deliverMusicArtwork: DeliverMusicArtwork,
) => {
  const provideDb = Effect.provideService(Database, db)

  const attachLink = (input: AttachMusicSourceLink) =>
    Effect.gen(function* () {
      const reference = { entityType: input.entityType, entityId: input.entityId }
      yield* annotateEntity(reference)
      yield* loadEntity(reference).pipe(provideDb)
      const source = yield* parseMusicSource(input.url, input.entityType)
      yield* annotateSource(source)
      const displayPlatform = displayPlatformFor(source, input.platform)

      if (!displayPlatform) {
        return yield* new MusicSourceInvalid({
          reason: 'platform_mismatch',
          message: 'Music source platform does not match the requested platform',
        })
      }

      const displayUrl =
        displayPlatform === source.platform ? source.canonicalUrl : source.normalizedUrl

      const existing = yield* readReference(source)

      if (existing && referenceKey(existing) !== referenceKey(reference)) {
        yield* repository.recordConflict(
          source.sourceKey,
          existing,
          reference,
          'manual_attachment_owned',
          new Date(),
        )

        return yield* new MusicIdentityConflict({
          sourceKey: source.sourceKey,
          incumbentEntityType: existing.entityType,
          incumbentEntityId: existing.entityId,
          candidateEntityType: reference.entityType,
          candidateEntityId: reference.entityId,
        })
      }

      if (existing) {
        const now = new Date()
        yield* repository.touchAlias(source, reference, now)

        const rows = yield* repository.upsertLink(
          reference,
          {
            platform: displayPlatform,
            url: displayUrl,
            scrapedAt: now,
            metadata: { discoveredBy: 'manual', confidence: 'exact_source' },
          },
          now,
        )

        const link = rows[0]

        if (!link) {
          yield* loadEntity(reference).pipe(provideDb)

          return yield* storageError('attachLink', 'Attached link was not persisted')
        }

        return link
      }

      const ownerToken = crypto.randomUUID()
      const claim = yield* claimWithWait(source, ownerToken)

      if (ClaimResult.$is('resolved')(claim)) {
        if (referenceKey(claim.reference) !== referenceKey(reference)) {
          yield* repository.recordConflict(
            source.sourceKey,
            claim.reference,
            reference,
            'manual_attachment_owned',
            new Date(),
          )

          return yield* new MusicIdentityConflict({
            sourceKey: source.sourceKey,
            incumbentEntityType: claim.reference.entityType,
            incumbentEntityId: claim.reference.entityId,
            candidateEntityType: reference.entityType,
            candidateEntityId: reference.entityId,
          })
        }
      } else {
        const scrapedAt = new Date()

        const link: ScrapedLink = {
          platform: displayPlatform,
          url: displayUrl,
          scrapedAt,
          metadata: { discoveredBy: 'manual', confidence: 'exact_source' },
        }

        const committed = yield* repository
          .commit({
            ownedSources: [source],
            allSources: [source],
            reference,
            links: [link],
            ownerToken,
            scrapedAt,
            now: new Date(),
          })
          .pipe(
            Effect.tapError(() => repository.release([source.sourceKey], ownerToken)),
            Effect.tap((didCommit) =>
              Effect.gen(function* () {
                yield* annotateSource(source)
                yield* annotateEntity(reference)
                yield* Effect.annotateCurrentSpan({
                  outcome: didCommit ? 'success' : 'lost_claim',
                  linkCount: 1,
                  aliasCount: 1,
                })
              }),
            ),
            withSafeTypedSpan('musicIdentity.commit'),
          )

        if (!committed) {
          yield* repository.release([source.sourceKey], ownerToken)
          yield* loadEntity(reference).pipe(provideDb)

          return yield* new MusicIdentityBusy({ retryAfterMs: claimLeaseMs })
        }
      }

      const links = yield* repository.linksFor(reference)
      const attached = links.find((candidate) => candidate.platform === displayPlatform)

      if (attached) return attached
      const now = new Date()

      const rows = yield* repository.upsertLink(
        reference,
        {
          platform: displayPlatform,
          url: displayUrl,
          scrapedAt: now,
          metadata: { discoveredBy: 'manual', confidence: 'exact_source' },
        },
        now,
      )

      const link = rows[0]

      if (!link) {
        yield* loadEntity(reference).pipe(provideDb)

        return yield* storageError('attachLink', 'Attached link was not persisted')
      }

      return link
    }).pipe(
      Effect.tap(() =>
        Effect.annotateCurrentSpan({
          origin: input.origin,
          outcome: 'success',
          linkCount: 1,
          aliasCount: 1,
        }),
      ),
      withSafeTypedSpan('musicIdentity.attachLink', {
        attributes: {
          origin: input.origin,
          entityType: input.entityType,
          entityId: input.entityId,
        },
      }),
    )

  const refresh = (input: RefreshMusicEntity, mode: RefreshMode) => {
    const explicitRefresh = mode === 'administrator_refresh'

    return Effect.gen(function* () {
      const reference = { entityType: input.entityType, entityId: input.entityId }
      yield* annotateEntity(reference)
      yield* Effect.annotateCurrentSpan('explicitRefresh', explicitRefresh)
      const current = yield* loadEntity(reference).pipe(provideDb)
      const links = yield* repository.linksFor(reference)

      if (
        !explicitRefresh &&
        links.some(
          (link) => link.status === 'verified' && link.metadata?.confidence !== 'exact_source',
        )
      ) {
        yield* Effect.annotateCurrentSpan({ outcome: 'skipped', linkCount: links.length })

        return yield* loadResolvedEntity(repository, reference, false).pipe(provideDb)
      }

      const exactSources = links
        .filter(
          (link) => link.metadata?.confidence === 'exact_source' && link.status === 'verified',
        )
        .sort(compareRefreshSourcePrecedence)

      const sourceLink = exactSources[0]

      if (!sourceLink) {
        return yield* new MusicIdentitySourceLinkNotFound({
          entityType: input.entityType,
          entityId: input.entityId,
        })
      }

      const source = yield* parseMusicSource(sourceLink.url, input.entityType)
      yield* annotateSource(source)
      const title = 'name' in current ? current.name : current.title

      const artistName =
        'artistNames' in current ? (current.artistNames ?? []).join(', ') : undefined

      const result = yield* (
        explicitRefresh
          ? scraper.scrape({ entityType: input.entityType, url: source.canonicalUrl })
          : scraper.discoverCrossPlatformLinks(
              omitUndefined({
                entityType: input.entityType,
                url: source.canonicalUrl,
                trackTitle: title,
                artistName,
              }),
            )
      ).pipe(
        Effect.mapError(providerError),
        Effect.tapError((error) =>
          Effect.annotateCurrentSpan({ provider: error.provider, outcome: 'failure' }),
        ),
        Effect.tap(() =>
          Effect.gen(function* () {
            yield* annotateSource(source)
            yield* Effect.annotateCurrentSpan({
              provider: source.platform,
              explicitRefresh,
              outcome: 'success',
            })
          }),
        ),
        withSafeTypedSpan('musicIdentity.scrape'),
      )

      if (
        result.links.length === 0 &&
        !result.entityMeta?.title &&
        !result.entityMeta?.artistName &&
        !result.entityMeta?.thumbnailUrl &&
        !result.entityMeta?.isrc
      ) {
        return yield* new MusicIdentityInvalidSnapshot({
          message: 'Music refresh returned no metadata or links',
        })
      }

      const scrapedAt = new Date()
      const discoveredLinks = uniqueLinks(source, result, scrapedAt)

      const refreshedLinks =
        input.entityType === 'playlist'
          ? discoveredLinks.filter((link) => link.platform === source.platform)
          : discoveredLinks

      const sources = yield* parseDiscoveredSources(source, refreshedLinks, input.entityType)
      const ownerToken = crypto.randomUUID()
      const ownedSources: Array<ParsedMusicSource> = []

      for (const discovered of sources) {
        const owner = yield* readReference(discovered)

        if (owner && referenceKey(owner) !== referenceKey(reference)) {
          yield* repository.recordConflict(
            discovered.sourceKey,
            owner,
            reference,
            'refresh_discovered_owned',
            new Date(),
          )
          yield* repository.release(
            ownedSources.map((owned) => owned.sourceKey),
            ownerToken,
          )

          return yield* new MusicIdentityConflict({
            sourceKey: discovered.sourceKey,
            incumbentEntityType: owner.entityType,
            incumbentEntityId: owner.entityId,
            candidateEntityType: reference.entityType,
            candidateEntityId: reference.entityId,
          })
        }

        if (owner) continue

        const claim = yield* claimWithWait(discovered, ownerToken).pipe(
          Effect.tapError(() =>
            repository.release(
              ownedSources.map((owned) => owned.sourceKey),
              ownerToken,
            ),
          ),
        )

        if (ClaimResult.$is('owned')(claim)) {
          ownedSources.push(discovered)
          continue
        }

        if (referenceKey(claim.reference) !== referenceKey(reference)) {
          yield* repository.recordConflict(
            discovered.sourceKey,
            claim.reference,
            reference,
            'refresh_discovered_owned',
            new Date(),
          )
          yield* repository.release(
            ownedSources.map((owned) => owned.sourceKey),
            ownerToken,
          )

          return yield* new MusicIdentityConflict({
            sourceKey: discovered.sourceKey,
            incumbentEntityType: claim.reference.entityType,
            incumbentEntityId: claim.reference.entityId,
            candidateEntityType: reference.entityType,
            candidateEntityId: reference.entityId,
          })
        }
      }

      const refreshed = refreshedEntityRecord(
        input.entityType,
        input.entityId,
        result,
        current,
        explicitRefresh ? 'replace_canonical' : 'preserve_canonical',
      )

      const committed = yield* repository
        .updateEntityMetadata({
          entity: refreshed,
          links: refreshedLinks,
          sources,
          ownedSources,
          ownerToken,
          now: new Date(),
        })
        .pipe(
          Effect.tapError(() =>
            repository.release(
              ownedSources.map((owned) => owned.sourceKey),
              ownerToken,
            ),
          ),
          Effect.tap((didCommit) =>
            Effect.gen(function* () {
              yield* annotateSource(source)
              yield* annotateEntity(reference)
              yield* Effect.annotateCurrentSpan({
                outcome: didCommit ? 'success' : 'lost_claim',
                linkCount: refreshedLinks.length,
                aliasCount: sources.length,
                explicitRefresh,
              })
            }),
          ),
          withSafeTypedSpan('musicIdentity.commit'),
        )

      if (!committed) {
        yield* repository.release(
          ownedSources.map((owned) => owned.sourceKey),
          ownerToken,
        )
        yield* loadEntity(reference).pipe(provideDb)

        return yield* new MusicIdentityBusy({ retryAfterMs: claimLeaseMs })
      }

      const resolved = yield* loadResolvedEntity(repository, reference, false).pipe(provideDb)

      const delivered = yield* deliverMusicArtwork({
        resolved,
        candidateUrl: result.entityMeta?.thumbnailUrl,
        delivery: input.artworkDelivery,
      })

      yield* Effect.annotateCurrentSpan({
        outcome: 'success',
        linkCount: delivered.links.length,
        aliasCount: sources.length,
      })

      return delivered
    }).pipe(
      withSafeTypedSpan('musicIdentity.refreshEntity', {
        attributes: {
          entityType: input.entityType,
          entityId: input.entityId,
          explicitRefresh,
          origin: input.origin,
        },
      }),
    )
  }

  const releaseLink = (input: ReleaseMusicSourceLink) =>
    Effect.gen(function* () {
      const reference = { entityType: input.entityType, entityId: input.entityId }
      yield* loadEntity(reference).pipe(provideDb)
      const link = yield* repository.linkById(reference, input.linkId)

      if (!link) {
        return yield* new MusicIdentitySourceLinkNotFound({
          entityType: input.entityType,
          entityId: input.entityId,
        })
      }

      const source =
        link.metadata?.confidence === 'exact_source'
          ? yield* parseMusicSource(link.url, input.entityType).pipe(
              Effect.catchTag('MusicSourceInvalid', () => Effect.succeed(undefined)),
            )
          : undefined

      const released = yield* repository.releaseLink(
        omitUndefined({
          reference,
          linkId: input.linkId,
          source,
          action: input.action,
          verifiedBy: input.verifiedBy,
          metadata: input.metadata ?? link.metadata ?? undefined,
          now: new Date(),
        }),
      )

      if (input.action === 'reject' && !released) {
        return yield* storageError('releaseLink', 'Rejected link was not persisted')
      }

      return released
    }).pipe(withSafeTypedSpan('musicIdentity.releaseLink'))

  const enrichEntity = (input: RefreshMusicEntity) => refresh(input, 'automatic_enrichment')
  const refreshEntity = (input: RefreshMusicEntity) => refresh(input, 'administrator_refresh')

  return { attachLink, releaseLink, enrichEntity, refreshEntity }
}
