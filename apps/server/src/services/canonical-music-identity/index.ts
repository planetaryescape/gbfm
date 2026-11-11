import { Context, Effect, Fiber, Layer, Option, Predicate } from 'effect'

import { Database } from '@/db/layer'
import { omitUndefined } from '@/lib/omit-undefined'
import { ConfigService } from '@/services/config.service'
import {
  MusicLinkScraperService,
  type MusicScraperError,
  type ScrapeResult,
} from '@/services/music-link-scraper.service'
import { S3Service } from '@/services/s3.service'

import { buildDeliverMusicArtwork, MusicCoverImageFetcher } from './artwork-delivery'
import type {
  AnyResolvedMusicEntity,
  CanonicalMusicIdentityService,
  ImportProviderMusicEntity,
  ImportProviderMusicEntityLazy,
  MusicIdentityAuthorization,
  ResolveMusicSource,
} from './contract'
import { buildEntityOperations } from './entity-operations'
import { loadEntity, loadResolvedEntity, prepareEntityRecord, slugFor } from './entity-record'
import {
  MusicIdentityBusy,
  MusicIdentityConflict,
  type MusicIdentityError,
  MusicIdentityInvalidSnapshot,
  MusicIdentityProviderRejected,
  MusicIdentityProviderUnavailable,
  MusicIdentityStorageError,
} from './errors'
import { CanonicalImportPersistence } from './import-persistence'
import {
  type CanonicalMusicEntityType,
  parseMusicSource,
  type ParsedMusicSource,
} from './music-source'
import {
  asResolvedReference,
  CanonicalMusicIdentityRepository,
  ClaimResult,
  type EntityReference,
  type SettledClaim,
} from './repository'
import {
  hasUsableResult,
  inferredType,
  parseDiscoveredSources,
  snapshotResult,
  uniqueLinks,
} from './source-result'
import { annotateEntity, annotateSource, withSafeSpan, withSafeTypedSpan } from './telemetry'

export type {
  AnyResolvedMusicEntity,
  AttachMusicSourceLink,
  CanonicalMusicIdentityService,
  ImportProviderMusicEntity,
  ImportProviderMusicEntityLazy,
  ArtworkDelivery,
  RefreshMusicEntity,
  MusicEntityByType,
  ResolutionOrigin,
  ResolvedMusicEntity,
  ResolveMusicSource,
} from './contract'

export type { ResolvedEntity } from './entity-record'

export type { MusicIdentityError } from './errors'

export type { CanonicalMusicEntityType } from './music-source'

export type { ProviderMusicLink, ProviderMusicSnapshot } from './source-result'

export const CanonicalMusicIdentity =
  Context.Service<CanonicalMusicIdentityService>('CanonicalMusicIdentity')

export type CanonicalMusicIdentityLeaseTimingConfig = {
  readonly leaseMs: number
  readonly waitAttempts: number
  readonly waitMs: number
}

export const CanonicalMusicIdentityLeaseTiming =
  Context.Reference<CanonicalMusicIdentityLeaseTimingConfig>('CanonicalMusicIdentityLeaseTiming', {
    defaultValue: () => ({ leaseMs: 30_000, waitAttempts: 40, waitMs: 25 }),
  })

const providerError = (error: MusicScraperError) => {
  if (error.statusCode === 400) {
    return new MusicIdentityProviderRejected({
      provider: error.provider,
      reason: 'invalid_request',
      message: error.message,
    })
  }

  if (error.statusCode === 404) {
    return new MusicIdentityProviderRejected({
      provider: error.provider,
      reason: 'not_found',
      message: error.message,
    })
  }

  if (error.statusCode === undefined) {
    return new MusicIdentityProviderUnavailable({
      provider: error.provider,
      message: error.message,
    })
  }

  return new MusicIdentityProviderUnavailable({
    provider: error.provider,
    statusCode: error.statusCode,
    message: error.message,
  })
}

const storageError = (operation: string, message: string) =>
  new MusicIdentityStorageError({ operation, message })

const referenceKey = (reference: EntityReference) => `${reference.entityType}:${reference.entityId}`

const legacyFallbackType = (source: ParsedMusicSource, expectedType?: CanonicalMusicEntityType) => {
  if (expectedType) return expectedType
  const type = source.sourceEntityType

  return type === 'artist' || type === 'album' || type === 'track' || type === 'playlist'
    ? type
    : undefined
}

const persistedArtwork = (resolved: AnyResolvedMusicEntity) =>
  resolved.entityType === 'artist' ? resolved.entity.imageUrl : resolved.entity.coverImageUrl

const checkAuthorization = (
  authorize: MusicIdentityAuthorization | undefined,
  entityType?: CanonicalMusicEntityType,
) => (authorize ? authorize(entityType) : Effect.void)

export const CanonicalMusicIdentityLayer = Layer.effect(
  CanonicalMusicIdentity,
  Effect.gen(function* () {
    const db = yield* Database
    const scraper = yield* MusicLinkScraperService
    const s3 = yield* S3Service
    const config = yield* ConfigService
    const fetcher = yield* MusicCoverImageFetcher
    const leaseTiming = yield* CanonicalMusicIdentityLeaseTiming
    const heartbeatMs = Math.max(1, Math.floor(leaseTiming.leaseMs / 3))
    const repository = new CanonicalMusicIdentityRepository(db)
    const provideDb = Effect.provideService(Database, db)

    const deliverMusicArtwork = buildDeliverMusicArtwork({
      s3,
      config,
      fetcher,
      repository,
      reload: (reference, created) =>
        loadResolvedEntity(repository, reference, created).pipe(provideDb),
    })

    const readReference = (source: ParsedMusicSource, authorize?: MusicIdentityAuthorization) =>
      Effect.gen(function* () {
        yield* annotateSource(source)
        const identity = yield* repository.lookup(source)

        if (!identity) {
          yield* Effect.annotateCurrentSpan({ result: 'miss', outcome: 'success' })

          return undefined
        }

        const reference = asResolvedReference(identity)

        if (!reference) {
          yield* Effect.annotateCurrentSpan({ result: 'miss', outcome: 'success' })

          return undefined
        }

        yield* checkAuthorization(authorize, reference.entityType)

        const entity = yield* loadEntity(reference).pipe(
          provideDb,
          Effect.catchTag('MusicIdentityEntityNotFound', () => Effect.succeed(undefined)),
        )

        if (entity) {
          yield* checkAuthorization(authorize, reference.entityType)

          if (Option.isNone(yield* Effect.serviceOption(CanonicalImportPersistence))) {
            yield* repository.touchAlias(source, reference, new Date())
          }

          yield* annotateEntity(reference)
          yield* Effect.annotateCurrentSpan({ result: 'hit', outcome: 'success' })

          return reference
        }

        if (Option.isSome(yield* Effect.serviceOption(CanonicalImportPersistence))) {
          return yield* storageError(
            'lookup',
            'Source target is missing; administrator reconciliation required',
          )
        }

        yield* repository.removeOrphan(reference)
        yield* Effect.annotateCurrentSpan({
          result: 'miss',
          outcome: 'success',
          orphanCount: 1,
        })

        return undefined
      }).pipe(withSafeTypedSpan('musicIdentity.lookup'))

    const findLegacyReference = (source: ParsedMusicSource, entityType: CanonicalMusicEntityType) =>
      Effect.gen(function* () {
        const candidates = yield* repository.legacyCandidates(source, entityType)

        for (const candidate of candidates) {
          const parsed = yield* parseMusicSource(candidate.url, entityType).pipe(
            Effect.catchTag('MusicSourceInvalid', () => Effect.succeed(undefined)),
          )

          if (!parsed || parsed.sourceKey !== source.sourceKey) continue
          const reference = { entityType, entityId: candidate.entityId }

          const entity = yield* loadEntity(reference).pipe(
            provideDb,
            Effect.catchTag('MusicIdentityEntityNotFound', () => Effect.succeed(undefined)),
          )

          if (entity) return reference
        }

        return undefined
      })

    const claimSource = (
      source: ParsedMusicSource,
      ownerToken: string,
      retryCount: number,
      authorize?: MusicIdentityAuthorization,
    ): Effect.Effect<ClaimResult, MusicIdentityError> =>
      Effect.gen(function* () {
        yield* annotateSource(source)
        yield* Effect.annotateCurrentSpan('retryCount', retryCount)
        yield* checkAuthorization(authorize)
        const claim = yield* repository.claim(source, ownerToken, new Date(), leaseTiming.leaseMs)

        if (Predicate.isTagged(claim, 'owned')) {
          yield* Effect.annotateCurrentSpan('result', claim.result)

          if (claim.claimAgeMs !== undefined) {
            yield* Effect.annotateCurrentSpan('claimAgeMs', claim.claimAgeMs)
          }
        } else if (Predicate.isTagged(claim, 'resolved')) {
          yield* checkAuthorization(authorize, claim.reference.entityType)
          yield* annotateEntity(claim.reference)
          yield* Effect.annotateCurrentSpan('result', 'hit')
        } else {
          yield* Effect.annotateCurrentSpan({
            result: 'wait',
            claimAgeMs: claim.claimAgeMs,
          })
        }

        yield* Effect.annotateCurrentSpan('outcome', 'success')

        return claim
      }).pipe(withSafeTypedSpan('musicIdentity.claim'))

    const claimWithWait = (
      source: ParsedMusicSource,
      ownerToken: string,
      attempt = 0,
      observedClaim?: ClaimResult,
      authorize?: MusicIdentityAuthorization,
    ): Effect.Effect<SettledClaim, MusicIdentityError> =>
      Effect.gen(function* () {
        const claim = observedClaim ?? (yield* claimSource(source, ownerToken, attempt, authorize))

        if (ClaimResult.$is('owned')(claim)) return claim

        if (ClaimResult.$is('resolved')(claim)) {
          yield* checkAuthorization(authorize, claim.reference.entityType)

          return claim
        }

        if (attempt >= leaseTiming.waitAttempts) {
          return yield* new MusicIdentityBusy({ retryAfterMs: claim.retryAfterMs })
        }

        yield* Effect.sleep(`${leaseTiming.waitMs} millis`)
        const reference = yield* readReference(source, authorize)

        if (reference) return ClaimResult.resolved({ reference })

        return yield* claimWithWait(source, ownerToken, attempt + 1, undefined, authorize)
      })

    const waitForResolved = (
      source: ParsedMusicSource,
      attempt = 0,
      authorize?: MusicIdentityAuthorization,
    ): Effect.Effect<EntityReference, MusicIdentityError> =>
      Effect.gen(function* () {
        const reference = yield* readReference(source, authorize)

        if (reference) return reference

        if (attempt >= leaseTiming.waitAttempts) {
          return yield* new MusicIdentityBusy({ retryAfterMs: leaseTiming.leaseMs })
        }

        yield* Effect.sleep(`${leaseTiming.waitMs} millis`)

        return yield* waitForResolved(source, attempt + 1, authorize)
      })

    const adoptLegacy = (
      source: ParsedMusicSource,
      entityType: CanonicalMusicEntityType,
      authorize?: MusicIdentityAuthorization,
    ): Effect.Effect<AnyResolvedMusicEntity | undefined, MusicIdentityError> =>
      Effect.gen(function* () {
        const legacy = yield* findLegacyReference(source, entityType)

        if (!legacy) return undefined
        yield* checkAuthorization(authorize, legacy.entityType)
        const ownerToken = crypto.randomUUID()
        const claim = yield* claimWithWait(source, ownerToken, 0, undefined, authorize)

        if (ClaimResult.$is('resolved')(claim)) {
          return yield* loadResolvedEntity(repository, claim.reference, false).pipe(provideDb)
        }

        yield* checkAuthorization(authorize, legacy.entityType).pipe(
          Effect.tapError(() => repository.release([source.sourceKey], ownerToken)),
        )

        const adopted = yield* repository
          .commit({
            ownedSources: [source],
            allSources: [source],
            reference: legacy,
            links: [
              {
                platform: source.platform,
                url: source.canonicalUrl,
                scrapedAt: new Date(),
                metadata: { discoveredBy: 'legacy_adoption', confidence: 'exact_source' },
              },
            ],
            ownerToken,
            scrapedAt: new Date(),
            now: new Date(),
          })
          .pipe(
            Effect.tapError(() => repository.release([source.sourceKey], ownerToken)),
            Effect.tap((committed) =>
              Effect.gen(function* () {
                yield* annotateSource(source)
                yield* annotateEntity(legacy)
                yield* Effect.annotateCurrentSpan({
                  outcome: committed ? 'success' : 'lost_claim',
                  linkCount: 1,
                  aliasCount: 1,
                })
              }),
            ),
            withSafeTypedSpan('musicIdentity.commit'),
          )

        if (adopted) return yield* loadResolvedEntity(repository, legacy, false).pipe(provideDb)
        yield* repository.release([source.sourceKey], ownerToken)
        const winner = yield* readReference(source, authorize)

        if (winner) return yield* loadResolvedEntity(repository, winner, false).pipe(provideDb)

        return yield* new MusicIdentityBusy({ retryAfterMs: leaseTiming.leaseMs })
      })

    const withClaimHeartbeat = <A, E, R>(
      ownedSources: ReadonlyArray<ParsedMusicSource>,
      ownerToken: string,
      effect: Effect.Effect<A, E, R>,
      authorize?: MusicIdentityAuthorization,
    ): Effect.Effect<A, MusicIdentityError | E, R> =>
      Effect.scoped(
        Effect.gen(function* () {
          const heartbeat = Effect.gen(function* () {
            yield* Effect.sleep(`${heartbeatMs} millis`)
            const sourceKeys = ownedSources.map((source) => source.sourceKey)

            yield* checkAuthorization(authorize)

            const renewed = yield* repository.renew(
              sourceKeys,
              ownerToken,
              new Date(),
              leaseTiming.leaseMs,
            )

            if (renewed.length !== sourceKeys.length) {
              return yield* new MusicIdentityBusy({ retryAfterMs: leaseTiming.leaseMs })
            }

            return undefined
          }).pipe(Effect.forever)

          const heartbeatFiber = yield* Effect.forkScoped(heartbeat)

          return yield* Effect.raceFirst(effect, Fiber.join(heartbeatFiber))
        }),
      )

    const resolvePrepared = <E, R>(
      initial: ParsedMusicSource,
      resultEffect: Effect.Effect<ScrapeResult, E, R>,
      entityDetails?: {
        readonly description?: string | undefined
        readonly trackNumber?: number | undefined
        readonly curatorId?: string | null | undefined
      },
      fallbackType?: CanonicalMusicEntityType,
      authorize?: MusicIdentityAuthorization,
    ): Effect.Effect<AnyResolvedMusicEntity, MusicIdentityError | E, R> =>
      Effect.gen(function* () {
        yield* checkAuthorization(authorize)
        const hit = yield* readReference(initial, authorize)

        if (hit) return yield* loadResolvedEntity(repository, hit, false).pipe(provideDb)

        if (fallbackType) {
          const adopted = yield* adoptLegacy(initial, fallbackType, authorize)

          if (adopted) return adopted
        }

        const ownerToken = crypto.randomUUID()
        const firstClaim = yield* claimWithWait(initial, ownerToken, 0, undefined, authorize)

        if (ClaimResult.$is('resolved')(firstClaim)) {
          return yield* loadResolvedEntity(repository, firstClaim.reference, false).pipe(provideDb)
        }

        const ownedSources: Array<ParsedMusicSource> = [initial]

        return yield* Effect.gen(function* () {
          yield* checkAuthorization(authorize)

          const result = yield* withClaimHeartbeat(
            ownedSources,
            ownerToken,
            resultEffect,
            authorize,
          )

          if (!hasUsableResult(result)) {
            return yield* new MusicIdentityInvalidSnapshot({
              message: 'Music source resolution returned no metadata or links',
            })
          }

          if (Option.isSome(yield* Effect.serviceOption(CanonicalImportPersistence))) {
            if (result.entityMeta?.type === 'playlist')
              yield* checkAuthorization(authorize, 'playlist')

            const observedType =
              result.entityMeta?.type === 'song' ? 'track' : result.entityMeta?.type

            if (
              observedType &&
              initial.sourceEntityType !== 'url' &&
              initial.sourceEntityType !== 'video' &&
              observedType !== initial.sourceEntityType
            ) {
              return yield* new MusicIdentityInvalidSnapshot({
                message: 'Provider entity type does not match the requested exact source',
              })
            }
          }

          const entityType = inferredType(initial, result)

          if (!entityType) {
            return yield* new MusicIdentityInvalidSnapshot({
              message: 'Music entity type could not be inferred',
            })
          }

          yield* checkAuthorization(authorize, entityType)
          const scrapedAt = new Date()
          const links = uniqueLinks(initial, result, scrapedAt)
          const sources = yield* parseDiscoveredSources(initial, links, entityType)
          const incumbents = new Map<string, EntityReference>()

          for (const source of sources) {
            if (source.sourceKey === initial.sourceKey) continue
            const existing = yield* readReference(source, authorize)

            if (existing) {
              incumbents.set(referenceKey(existing), existing)
              continue
            }

            const attempted = yield* claimSource(source, ownerToken, 0, authorize)

            if (Predicate.isTagged(attempted, 'owned')) {
              ownedSources.push(source)
              continue
            }

            if (Predicate.isTagged(attempted, 'resolved')) {
              incumbents.set(referenceKey(attempted.reference), attempted.reference)
              continue
            }

            if (source.sourceKey < initial.sourceKey) {
              yield* repository.release(
                ownedSources.map((owned) => owned.sourceKey),
                ownerToken,
              )
              const winner = yield* waitForResolved(initial, 0, authorize)

              return yield* loadResolvedEntity(repository, winner, false).pipe(provideDb)
            }

            const claim = yield* claimWithWait(source, ownerToken, 0, attempted, authorize)

            if (ClaimResult.$is('owned')(claim)) ownedSources.push(source)
            else incumbents.set(referenceKey(claim.reference), claim.reference)
          }

          if (incumbents.size > 1) {
            const values = [...incumbents.values()]
            const incumbent = values[0]
            const candidate = values[1]

            if (!incumbent || !candidate) {
              return yield* storageError('collision', 'Identity collision references are missing')
            }

            let conflictSourceKey = initial.sourceKey

            for (const source of sources) {
              const identity = yield* repository.lookup(source)
              const reference = identity ? asResolvedReference(identity) : undefined

              if (reference && referenceKey(reference) === referenceKey(candidate)) {
                conflictSourceKey = source.sourceKey
                break
              }
            }

            yield* repository.recordConflict(
              conflictSourceKey,
              incumbent,
              candidate,
              'discovered_sources_disagree',
              new Date(),
            )

            return yield* new MusicIdentityConflict({
              sourceKey: conflictSourceKey,
              incumbentEntityType: incumbent.entityType,
              incumbentEntityId: incumbent.entityId,
              candidateEntityType: candidate.entityType,
              candidateEntityId: candidate.entityId,
            })
          }

          const incumbent = [...incumbents.values()][0]

          if (incumbent && Option.isSome(yield* Effect.serviceOption(CanonicalImportPersistence))) {
            const existingLinks = yield* repository.linksFor(incumbent)

            for (const link of existingLinks) {
              const proposed = links.find((value) => value.platform === link.platform)

              if (!proposed) continue

              const parsed = yield* parseMusicSource(link.url, incumbent.entityType).pipe(
                Effect.catchTag('MusicSourceInvalid', () => Effect.succeed(undefined)),
              )

              const proposedSource = yield* parseMusicSource(
                proposed.url,
                incumbent.entityType,
              ).pipe(Effect.catchTag('MusicSourceInvalid', () => Effect.succeed(undefined)))

              if (parsed && proposedSource && parsed.sourceKey !== proposedSource.sourceKey) {
                return yield* new MusicIdentityConflict({
                  sourceKey: initial.sourceKey,
                  incumbentEntityType: incumbent.entityType,
                  incumbentEntityId: incumbent.entityId,
                  candidateEntityType: entityType,
                  candidateEntityId: incumbent.entityId,
                })
              }
            }
          }

          const reference: EntityReference = incumbent ?? {
            entityType,
            entityId: crypto.randomUUID(),
          }

          yield* checkAuthorization(authorize, reference.entityType)

          const entity = incumbent
            ? undefined
            : yield* prepareEntityRecord(db, entityType, reference.entityId, result, entityDetails)

          const slug = entity
            ? yield* Effect.tryPromise({
                try: () => slugFor(db, entity),
                catch: (cause) =>
                  storageError(
                    'slug',
                    cause instanceof Error ? cause.message : 'Slug lookup failed',
                  ),
              })
            : undefined

          yield* checkAuthorization(authorize, reference.entityType)

          const renewed = yield* repository.renew(
            ownedSources.map((source) => source.sourceKey),
            ownerToken,
            new Date(),
            leaseTiming.leaseMs,
          )

          if (renewed.length !== ownedSources.length) {
            return yield* new MusicIdentityBusy({ retryAfterMs: leaseTiming.leaseMs })
          }

          yield* checkAuthorization(authorize, reference.entityType)

          const committed = yield* repository
            .commit(
              omitUndefined({
                ownedSources,
                allSources: sources,
                reference,
                entity,
                slug,
                links,
                ownerToken,
                scrapedAt,
                now: new Date(),
              }),
            )
            .pipe(
              Effect.tap((didCommit) =>
                Effect.gen(function* () {
                  yield* annotateSource(initial)
                  yield* annotateEntity(reference)
                  yield* Effect.annotateCurrentSpan({
                    outcome: didCommit ? 'success' : 'lost_claim',
                    linkCount: links.length,
                    aliasCount: sources.length,
                  })
                }),
              ),
              withSafeTypedSpan('musicIdentity.commit'),
            )

          if (!committed) {
            const winner = yield* readReference(initial, authorize)

            if (winner) return yield* loadResolvedEntity(repository, winner, false).pipe(provideDb)

            return yield* new MusicIdentityBusy({ retryAfterMs: leaseTiming.leaseMs })
          }

          return yield* loadResolvedEntity(repository, reference, !incumbent).pipe(provideDb)
        }).pipe(
          Effect.tapError(() =>
            repository.release(
              ownedSources.map((source) => source.sourceKey),
              ownerToken,
            ),
          ),
        )
      })

    const resolveSource = (input: ResolveMusicSource) => {
      let candidateArtworkUrl: string | undefined

      return Effect.gen(function* () {
        const source = yield* parseMusicSource(input.url, input.expectedType)
        yield* annotateSource(source)

        const resolved = yield* resolvePrepared(
          source,
          Effect.suspend(() =>
            scraper
              .scrape(omitUndefined({ url: source.canonicalUrl, entityType: input.expectedType }))
              .pipe(
                Effect.mapError(providerError),
                Effect.tapError((error) =>
                  Effect.annotateCurrentSpan({ provider: error.provider, outcome: 'failure' }),
                ),
                Effect.tap((result) =>
                  Effect.gen(function* () {
                    candidateArtworkUrl = result.entityMeta?.thumbnailUrl
                    yield* annotateSource(source)
                    yield* Effect.annotateCurrentSpan({
                      provider: source.platform,
                      outcome: 'success',
                    })
                  }),
                ),
                withSafeTypedSpan('musicIdentity.scrape'),
              ),
          ),
          undefined,
          legacyFallbackType(source, input.expectedType),
          input.authorize,
        )

        yield* checkAuthorization(input.authorize, resolved.entityType)

        const delivered = yield* deliverMusicArtwork({
          resolved,
          candidateUrl: candidateArtworkUrl ?? persistedArtwork(resolved),
          delivery: input.artworkDelivery,
          authorize: input.authorize,
        })

        yield* annotateEntity({ entityType: delivered.entityType, entityId: delivered.entity.id })
        yield* Effect.annotateCurrentSpan({
          outcome: 'success',
          linkCount: delivered.links.length,
          explicitRefresh: false,
        })

        return delivered
      }).pipe(
        withSafeTypedSpan('musicIdentity.resolveSource', {
          attributes: { origin: input.origin },
        }),
      )
    }

    const importProviderEntity = (input: ImportProviderMusicEntity) =>
      Effect.gen(function* () {
        if (!input.snapshot.title.trim()) {
          return yield* new MusicIdentityInvalidSnapshot({ message: 'Snapshot title is required' })
        }

        const source = yield* parseMusicSource(input.snapshot.sourceUrl, input.snapshot.entityType)
        yield* annotateSource(source)

        const resolved = yield* resolvePrepared(
          source,
          Effect.succeed(snapshotResult(input.snapshot, source)),
          input.snapshot,
          input.snapshot.entityType,
        )

        const delivered = yield* deliverMusicArtwork({
          resolved,
          candidateUrl: input.snapshot.imageUrl ?? persistedArtwork(resolved),
          delivery: input.artworkDelivery,
        })

        yield* annotateEntity({ entityType: delivered.entityType, entityId: delivered.entity.id })
        yield* Effect.annotateCurrentSpan({
          outcome: 'success',
          linkCount: delivered.links.length,
          explicitRefresh: false,
        })

        return delivered
      }).pipe(
        withSafeTypedSpan('musicIdentity.importProviderEntity', {
          attributes: { origin: input.origin, entityType: input.snapshot.entityType },
        }),
      )

    const importProviderEntityLazy = <E, R>(input: ImportProviderMusicEntityLazy<E, R>) => {
      let candidateArtworkUrl: string | undefined

      return Effect.gen(function* () {
        const source = yield* parseMusicSource(input.sourceUrl, input.entityType)
        yield* annotateSource(source)

        const resolved = yield* resolvePrepared(
          source,
          Effect.gen(function* () {
            yield* annotateSource(source)
            yield* Effect.annotateCurrentSpan('provider', source.platform)

            return yield* input.loadSnapshot
          }).pipe(
            Effect.tap(() => Effect.annotateCurrentSpan('outcome', 'success')),
            withSafeSpan('musicIdentity.scrape'),
            Effect.flatMap((loaded) => {
              candidateArtworkUrl = loaded.imageUrl

              if (!loaded.title.trim()) {
                return Effect.fail(
                  new MusicIdentityInvalidSnapshot({ message: 'Snapshot title is required' }),
                )
              }

              return parseMusicSource(loaded.sourceUrl, loaded.entityType).pipe(
                Effect.flatMap((loadedSource) =>
                  loadedSource.sourceKey === source.sourceKey
                    ? Effect.succeed(snapshotResult(loaded, source))
                    : Effect.fail(
                        new MusicIdentityInvalidSnapshot({
                          message: 'Loaded snapshot does not match the requested source',
                        }),
                      ),
                ),
              )
            }),
          ),
          undefined,
          input.entityType,
        )

        const delivered = yield* deliverMusicArtwork({
          resolved,
          candidateUrl: candidateArtworkUrl ?? persistedArtwork(resolved),
          delivery: input.artworkDelivery,
        })

        yield* annotateEntity({ entityType: delivered.entityType, entityId: delivered.entity.id })
        yield* Effect.annotateCurrentSpan({
          outcome: 'success',
          linkCount: delivered.links.length,
          explicitRefresh: false,
        })

        return delivered
      }).pipe(
        withSafeSpan('musicIdentity.importProviderEntityLazy', {
          attributes: { origin: input.origin, entityType: input.entityType },
        }),
      )
    }

    const { attachLink, enrichEntity, refreshEntity, releaseLink } = buildEntityOperations(
      db,
      scraper,
      repository,
      readReference,
      claimWithWait,
      providerError,
      leaseTiming.leaseMs,
      deliverMusicArtwork,
    )

    return {
      resolveSource,
      importProviderEntity,
      importProviderEntityLazy,
      attachLink,
      releaseLink,
      enrichEntity,
      refreshEntity,
    } satisfies CanonicalMusicIdentityService
  }),
)
