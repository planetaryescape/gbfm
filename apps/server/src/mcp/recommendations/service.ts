import { Clock, Context, Effect, Layer, Schema } from 'effect'

import { Database } from '@/db/layer'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { checkpointEditorialCommand } from '../editorial-music/save'
import {
  EditorialEvidenceStore,
  EditorialEvidenceStoreLayer,
  researchUnavailable,
} from '../editorial-research/evidence'
import { compareEvidenceKeys, evidenceFingerprint } from '../editorial-research/fingerprint'
import { boundEvidenceResult, withinEvidenceBudget } from '../editorial-research/service'
import { suggestEditorialConnections } from './connections'
import {
  MusicRef,
  RankingEvidence,
  type RecommendationLimit,
  type SimilarInput,
  SimilarResult,
} from './contracts'
import { suggestPlaylistSequence } from './playlist'

const makeRecommendations = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const store = yield* EditorialEvidenceStore
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(researchUnavailable),
  )

  const findSimilarMusic = Effect.fn('MusicRecommendations.similar')(function* (
    input: typeof SimilarInput.Type,
  ) {
    yield* authorization.requireScopes(['catalogue:read'])
    const now = yield* Clock.currentTimeMillis
    const observedAt = new Date(now).toISOString()
    const session = store.open(now)
    const seed = yield* session.requireEntity(input.seed)
    const rows = yield* session.related(input.seed)
    const truncatedEdges = yield* session.seedEdgesTruncated(input.seed)
    const window = rows.slice(0, 200)
    const selected = window.slice(0, input.limit ?? 10)

    const inputs = {
      seed: input.seed,
      seedVersion: yield* evidenceFingerprint({
        ...seed,
        publishedAt: new Date(seed.publishedAt).toISOString(),
        updatedAt: new Date(seed.updatedAt).toISOString(),
      }),
      limit: input.limit ?? 10,
    }

    const evidence = yield* Effect.forEach(selected, (row) =>
      Effect.gen(function* () {
        const music = yield* Schema.decodeUnknownEffect(MusicRef)(row).pipe(
          Effect.mapError(researchUnavailable),
        )

        const assertion = yield* Schema.decodeUnknownEffect(RankingEvidence)({
          id: '',
          kind: row.kind,
          subjects: [input.seed, music],
          witnessId: row.witnessId,
          sourceLocator: `gbfm:relation:${row.kind}:${input.seed.entityType}:${encodeURIComponent(input.seed.entityId)}:${encodeURIComponent(row.entityId)}:${encodeURIComponent(row.witnessId ?? '')}`,
          sourceFingerprint: '',
          observedAt,
        }).pipe(Effect.mapError(researchUnavailable))

        return {
          ...assertion,
          sourceFingerprint: yield* evidenceFingerprint({
            kind: assertion.kind,
            subjects: assertion.subjects,
            witnessId: assertion.witnessId,
          }),
        }
      }),
    )

    evidence.sort(
      (a, b) =>
        compareEvidenceKeys(a.kind, b.kind) ||
        compareEvidenceKeys(a.sourceLocator, b.sourceLocator),
    )
    const numbered = evidence.map((item, index) => ({ ...item, id: `e${index + 1}` }))

    const candidates = yield* Effect.forEach(selected, (row) =>
      Effect.gen(function* () {
        const music = yield* Schema.decodeUnknownEffect(MusicRef)(row).pipe(
          Effect.mapError(researchUnavailable),
        )

        return {
          music,
          name: row.name,
          slug: row.slug,
          tier: row.tier,
          evidenceIds: numbered
            .filter((item) =>
              item.subjects.some(
                (subject) =>
                  subject.entityType === music.entityType && subject.entityId === music.entityId,
              ),
            )
            .map((item) => item.id),
          explanation: `Related within examined catalogue relationships: ${row.kind.replaceAll('_', ' ')}. Not sonic similarity.`,
        }
      }),
    )

    const limits: Array<typeof RecommendationLimit.Type> = []

    if (rows.length > 200)
      limits.push({ code: 'candidate_window_truncated', affected: input.seed, relationKind: null })

    if (selected.length === 0) {
      const missing: Array<typeof RankingEvidence.Type.kind> = ['shared_genre']

      if (input.seed.entityType === 'track') missing.push('same_album')

      if (input.seed.entityType !== 'artist') missing.push('shared_artist')

      if (input.seed.entityType !== 'track') missing.push('shared_music_label')
      limits.push(
        ...missing.map((relationKind) => ({
          code: 'missing_relation' as const,
          affected: input.seed,
          relationKind,
        })),
      )
    }

    if (truncatedEdges)
      limits.push({ code: 'seed_edge_window', affected: input.seed, relationKind: null })
    limits.sort(
      (a, b) =>
        compareEvidenceKeys(a.code, b.code) ||
        compareEvidenceKeys(a.relationKind ?? '', b.relationKind ?? ''),
    )
    const status = candidates.length > 0 ? 'sufficient' : 'insufficient_evidence'

    const basisDigest = yield* evidenceFingerprint({
      contractVersion: 1,
      algorithmVersion: 'catalogue_relations_v1',
      inputs,
      evidence: numbered.map(({ observedAt: _observedAt, ...item }) => item),
      result: {
        status,
        candidates: candidates.map(({ explanation: _explanation, ...candidate }) => candidate),
      },
      limits,
    })

    const output = yield* Schema.decodeUnknownEffect(SimilarResult)({
      contractVersion: 1,
      algorithmVersion: 'catalogue_relations_v1',
      endpoint,
      observedAt,
      inputs,
      status,
      candidates,
      evidence: numbered,
      limits,
      basisDigest,
      candidateWindow: { examined: window.length, cap: 200, truncated: rows.length > 200 },
    }).pipe(Effect.mapError(researchUnavailable), Effect.flatMap(boundEvidenceResult))

    const actor = yield* authorization.requireScopes(['catalogue:read'])
    yield* checkpointEditorialCommand(['catalogue:read'], actor.userId)

    return output
  }, withinEvidenceBudget)

  return {
    findSimilarMusic,
    suggestEditorialConnections: (input: Parameters<typeof suggestEditorialConnections>[0]) =>
      suggestEditorialConnections(input).pipe(
        Effect.provideService(Database, db),
        Effect.provideService(McpAuthorization, authorization),
        Effect.provideService(EditorialMcpConfig, config),
        Effect.provideService(EditorialEvidenceStore, store),
      ),
    suggestPlaylistSequence: (input: Parameters<typeof suggestPlaylistSequence>[0]) =>
      suggestPlaylistSequence(input).pipe(
        Effect.provideService(Database, db),
        Effect.provideService(McpAuthorization, authorization),
        Effect.provideService(EditorialMcpConfig, config),
      ),
  }
})

export class MusicRecommendationService extends Context.Service<
  MusicRecommendationService,
  Effect.Success<typeof makeRecommendations>
>()('gbfm/mcp/MusicRecommendationService') {}

export const MusicRecommendationServiceLayer = Layer.effect(
  MusicRecommendationService,
  makeRecommendations,
).pipe(Layer.provide(McpAuthorizationLive), Layer.provide(EditorialEvidenceStoreLayer))
