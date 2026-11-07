import { Clock, Effect, Schema } from 'effect'

import { McpAuthorization } from '../authorization'
import { EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { checkpointEditorialCommand } from '../editorial-music/save'
import { readResearchEditorial } from '../editorial-research/context'
import type { EditorialContextInput } from '../editorial-research/contracts'
import { EditorialEvidenceStore, researchUnavailable } from '../editorial-research/evidence'
import { compareEvidenceKeys, evidenceFingerprint } from '../editorial-research/fingerprint'
import { boundEvidenceResult, withinEvidenceBudget } from '../editorial-research/service'
import {
  ConnectionEvidence,
  type ConnectionsInput,
  ConnectionsResult,
  MusicRef,
  type RecommendationLimit,
} from './contracts'

export const suggestEditorialConnections = Effect.fn('MusicRecommendations.connections')(function* (
  input: typeof ConnectionsInput.Type,
) {
  const authorization = yield* McpAuthorization
  const config = yield* EditorialMcpConfig
  const store = yield* EditorialEvidenceStore
  const now = yield* Clock.currentTimeMillis
  const observedAt = new Date(now).toISOString()
  const session = store.open(now)

  const sourceInput: {
    postId: typeof EditorialContextInput.Type.postId
    expectedVersion?: typeof EditorialContextInput.Type.expectedVersion
  } | null = input.postId === undefined ? null : { postId: input.postId }

  if (sourceInput !== null && input.expectedVersion !== undefined)
    sourceInput.expectedVersion = input.expectedVersion
  const source = sourceInput === null ? null : yield* readResearchEditorial(sourceInput)
  const scopes = source?.scopes ?? (['catalogue:read', 'content:read'] as const)
  const actor = source?.actor ?? (yield* authorization.requireScopes(scopes))

  if (source === null) yield* checkpointEditorialCommand(scopes, actor.userId)
  const primary = source?.snapshot.musicReferences.primary
  const requested = input.music ?? primary ?? null
  const limits: Array<typeof RecommendationLimit.Type> = []
  let music: MusicRef | null = null
  let seedVersion: string | null = null

  if (requested === null) {
    limits.push({ code: 'missing_structured_reference', affected: null, relationKind: null })
  } else if (requested.entityType === 'playlist') {
    limits.push({ code: 'unsupported_seed_relation', affected: null, relationKind: null })
  } else {
    const ref = { entityType: requested.entityType, entityId: requested.entityId }
    const seed = source ? (yield* session.getEntities([ref]))[0] : yield* session.requireEntity(ref)

    if (!seed) {
      limits.push({ code: 'missing_eligible_reference', affected: null, relationKind: null })
    } else {
      music = yield* Schema.decodeUnknownEffect(MusicRef)(requested).pipe(
        Effect.mapError(researchUnavailable),
      )
      seedVersion = yield* evidenceFingerprint({
        ...seed,
        publishedAt: new Date(seed.publishedAt).toISOString(),
        updatedAt: new Date(seed.updatedAt).toISOString(),
      })

      if (music.entityType === 'artist')
        limits.push({ code: 'unsupported_seed_relation', affected: music, relationKind: null })
    }
  }

  const related = music && music.entityType !== 'artist' ? yield* session.related(music) : []

  const edgesTruncated =
    music && music.entityType !== 'artist' ? yield* session.seedEdgesTruncated(music) : false

  const refs =
    music && music.entityType !== 'artist'
      ? [
          { ...music, tier: 1 },
          ...related.slice(0, 200).map((row) => ({
            entityType: row.entityType,
            entityId: row.entityId,
            tier: row.tier + 1,
          })),
        ]
      : []

  const page =
    refs.length > 0
      ? yield* session.coverage(refs, 200, true, source?.snapshot.id ?? null)
      : { rows: [], hasMore: false }

  if (related.length > 200 || page.hasMore)
    limits.push({ code: 'candidate_window_truncated', affected: music, relationKind: null })

  if (edgesTruncated) limits.push({ code: 'seed_edge_window', affected: music, relationKind: null })
  limits.sort((a, b) => compareEvidenceKeys(a.code, b.code))

  const selected = page.rows.slice(0, input.limit ?? 10)
  const assertions: Array<typeof ConnectionEvidence.Type> = []

  for (const post of selected) {
    const values = {
      postId: post.postId,
      updatedAt: new Date(post.updatedAt).toISOString(),
      music: post.music,
    }

    assertions.push({
      id: '',
      kind: 'post_music_reference',
      subjects: [{ entityType: 'post', entityId: post.postId }, post.music],
      sourceLocator: `gbfm:post-primary:${encodeURIComponent(post.postId)}:${post.music.entityType}:${encodeURIComponent(post.music.entityId)}`,
      sourceFingerprint: yield* evidenceFingerprint(values),
      observedAt,
    })

    const row = related.find(
      (entry) =>
        entry.entityType === post.music.entityType && entry.entityId === post.music.entityId,
    )

    if (row && music) {
      const subjects = [music, post.music]
      assertions.push(
        yield* Schema.decodeUnknownEffect(ConnectionEvidence)({
          id: '',
          kind: row.kind,
          subjects,
          witnessId: row.witnessId,
          sourceLocator: `gbfm:relation:${row.kind}:${music.entityType}:${encodeURIComponent(music.entityId)}:${encodeURIComponent(row.entityId)}:${encodeURIComponent(row.witnessId ?? '')}`,
          sourceFingerprint: yield* evidenceFingerprint({
            kind: row.kind,
            subjects,
            witnessId: row.witnessId,
          }),
          observedAt,
        }).pipe(Effect.mapError(researchUnavailable)),
      )
    }
  }

  const evidence = [...new Map(assertions.map((item) => [item.sourceLocator, item])).values()]
    .sort(
      (a, b) =>
        compareEvidenceKeys(a.kind, b.kind) ||
        compareEvidenceKeys(a.sourceLocator, b.sourceLocator),
    )
    .map((item, index) => ({ ...item, id: `e${index + 1}` }))

  const candidates = selected.map((post) => ({
    postId: post.postId,
    title: post.title,
    url: new URL(`/editorial/${encodeURIComponent(post.slug)}`, config.frontendUrl).href,
    tier:
      refs.find(
        (ref) => ref.entityType === post.music.entityType && ref.entityId === post.music.entityId,
      )?.tier ?? 1,
    evidenceIds: evidence
      .filter((item) =>
        item.subjects.some((ref) =>
          item.kind === 'post_music_reference'
            ? ref.entityType === 'post' && ref.entityId === post.postId
            : ref.entityType === post.music.entityType && ref.entityId === post.music.entityId,
        ),
      )
      .map((item) => item.id),
    explanation:
      'Published editorial with a recorded primary music reference within examined catalogue relationships. Not comprehensive coverage or a historical claim.',
  }))

  const inputs = {
    music,
    postId: source?.snapshot.id ?? null,
    postVersion: source?.version ?? null,
    seedVersion,
    limit: input.limit ?? 10,
  }

  const status = candidates.length ? 'sufficient' : 'insufficient_evidence'

  const output = yield* Schema.decodeUnknownEffect(ConnectionsResult)({
    contractVersion: 1,
    algorithmVersion: 'editorial_relations_v1',
    endpoint: yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
      Effect.mapError(researchUnavailable),
    ),
    observedAt,
    inputs,
    status,
    evidence,
    limits,
    candidates,
    candidateWindow: { examined: page.rows.length, cap: 200, truncated: page.hasMore },
    basisDigest: yield* evidenceFingerprint({
      contractVersion: 1,
      algorithmVersion: 'editorial_relations_v1',
      inputs,
      evidence: evidence.map(({ observedAt: _observedAt, ...item }) => item),
      result: {
        status,
        candidates: candidates.map(({ explanation: _explanation, ...candidate }) => candidate),
      },
      limits,
    }),
  }).pipe(Effect.mapError(researchUnavailable), Effect.flatMap(boundEvidenceResult))

  yield* checkpointEditorialCommand(scopes, actor.userId)

  return output
}, withinEvidenceBudget)
