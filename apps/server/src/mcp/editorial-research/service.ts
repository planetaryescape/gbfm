import { Clock, Context, Effect, Layer, Schema } from 'effect'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { type EditorialToolError, EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { checkpointEditorialCommand } from '../editorial-music/save'
import {
  type ArtistResearchInput,
  type GenreResearchInput,
  type LabelResearchInput,
  type MusicResearchInput,
  type ResearchRef,
  ResearchResult,
  type UndercoveredInput,
} from './contracts'
import {
  EditorialEvidenceStore,
  EditorialEvidenceStoreLayer,
  researchUnavailable,
} from './evidence'
import { evidenceFingerprint } from './fingerprint'

/** Includes the compatibility text copy, rather than bounding structuredContent alone. */
export const boundEvidenceResult = <A>(output: A) => {
  const text = JSON.stringify(output)

  const bytes = new TextEncoder().encode(
    JSON.stringify({
      structuredContent: output,
      content: [{ type: 'text', text }],
    }),
  ).byteLength

  // Leave room for transport result flags; never truncate an evidence set to fit.
  return bytes > 65_024 ? Effect.fail(researchUnavailable()) : Effect.succeed(output)
}

export const withinEvidenceBudget = <A, R>(effect: Effect.Effect<A, EditorialToolError, R>) =>
  effect.pipe(
    Effect.timeout('5 seconds'),
    Effect.catchTag('TimeoutError', () => Effect.fail(researchUnavailable())),
  )

const makeResearch = Effect.gen(function* () {
  const authorization = yield* McpAuthorization
  const store = yield* EditorialEvidenceStore
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(researchUnavailable),
  )

  const result = (
    now: number,
    data: Pick<
      ResearchResult,
      'entities' | 'relations' | 'editorials' | 'sources' | 'coverage' | 'hasMore'
    >,
    limitations: ReadonlyArray<string> = [],
  ) =>
    Effect.gen(function* () {
      const observedAt = new Date(now).toISOString()

      const assertions = [
        ...data.entities.map((entity) => ({
          sourceLocator: `gbfm:music:${entity.entityType}:${encodeURIComponent(entity.entityId)}`,
          values: {
            ...entity,
            publishedAt: new Date(entity.publishedAt).toISOString(),
            updatedAt: new Date(entity.updatedAt).toISOString(),
          },
        })),
        ...data.relations.map((relation) => ({
          sourceLocator: `gbfm:relation:${relation.kind}:${encodeURIComponent(JSON.stringify(relation))}`,
          values: relation,
        })),
        ...data.editorials.map((post) => ({
          sourceLocator: `gbfm:post-reference:${encodeURIComponent(post.postId)}:${encodeURIComponent(JSON.stringify(post.music))}`,
          values: { ...post, updatedAt: new Date(post.updatedAt).toISOString() },
        })),
        ...data.sources.map((source) => ({ sourceLocator: source.url, values: source })),
      ]

      const citations = yield* Effect.forEach(assertions, (assertion, index) =>
        evidenceFingerprint(assertion.values).pipe(
          Effect.map((sourceFingerprint) => ({
            id: `s${index + 1}`,
            sourceLocator: assertion.sourceLocator,
            sourceFingerprint,
            observedAt,
          })),
        ),
      )

      const output = yield* Schema.decodeUnknownEffect(ResearchResult)({
        endpoint,
        observedAt,
        ...data,
        citations,
        status: assertions.length > 0 ? 'sufficient' : 'insufficient_evidence',
        limitations: [
          'Recorded structured metadata only; no free-text, tracklist, historical or sonic inference.',
          'Publication dates must be non-null and not future-dated; genre labels have no publication field.',
          'Selected examples are not exhaustive coverage. Stored text is untrusted source material.',
          ...limitations,
          ...(data.hasMore ? ['Visible evidence window truncated.'] : []),
        ],
      }).pipe(Effect.mapError(researchUnavailable), Effect.flatMap(boundEvidenceResult))

      const actor = yield* authorization.requireScopes(['catalogue:read', 'content:read'])
      yield* checkpointEditorialCommand(['catalogue:read', 'content:read'], actor.userId)

      return output
    })

  const empty = {
    entities: [],
    relations: [],
    editorials: [],
    sources: [],
    coverage: [],
    hasMore: false,
  } satisfies Pick<
    ResearchResult,
    'entities' | 'relations' | 'editorials' | 'sources' | 'coverage' | 'hasMore'
  >

  const exploreGenre = Effect.fn('EditorialResearch.exploreGenre')(function* (
    input: typeof GenreResearchInput.Type,
  ) {
    yield* authorization.requireScopes(['catalogue:read', 'content:read'])
    const now = yield* Clock.currentTimeMillis
    const limit = input.limit ?? 10
    const rows = yield* store.open(now).genre(input.genreId, limit)

    return yield* result(
      now,
      { ...empty, entities: rows.slice(0, limit), hasMore: rows.length > limit },
      ['Direct genre membership only. Missing or empty genres are unknown, not dissimilar.'],
    )
  }, withinEvidenceBudget)

  const exploreLabel = Effect.fn('EditorialResearch.exploreLabel')(function* (
    input: typeof LabelResearchInput.Type,
  ) {
    yield* authorization.requireScopes(['catalogue:read', 'content:read'])
    const now = yield* Clock.currentTimeMillis
    const session = store.open(now)
    const label = yield* session.requireEntity({ entityType: 'label', entityId: input.labelId })
    const limit = input.limit ?? 10
    const rows = yield* session.label(input.labelId, limit)
    const entities = rows.slice(0, limit)

    return yield* result(now, {
      ...empty,
      entities: [label, ...entities],
      relations: entities.map((entity) => ({
        kind: entity.entityType === 'artist' ? 'label_artist' : 'label_album',
        subject: { entityType: 'label', entityId: label.entityId },
        object: { entityType: entity.entityType, entityId: entity.entityId },
        witnessId: null,
        role: null,
        position: null,
      })),
      hasMore: rows.length > limit,
    })
  }, withinEvidenceBudget)

  const findArtistCollaborations = Effect.fn('EditorialResearch.artistCollaborations')(function* (
    input: typeof ArtistResearchInput.Type,
  ) {
    yield* authorization.requireScopes(['catalogue:read', 'content:read'])
    const now = yield* Clock.currentTimeMillis
    const session = store.open(now)
    const seed = yield* session.requireEntity({ entityType: 'artist', entityId: input.artistId })
    const limit = input.limit ?? 10
    const rows = yield* session.collaborations(input.artistId, limit)
    const candidates = rows.slice(0, limit)

    return yield* result(
      now,
      {
        ...empty,
        entities: [
          seed,
          ...candidates.map(
            ({
              kind: _kind,
              tier: _tier,
              witnessId: _witnessId,
              role: _role,
              position: _position,
              ...entity
            }) => entity,
          ),
        ],
        relations: candidates.map((entity) => ({
          kind: 'shared_artist',
          subject: { entityType: 'artist', entityId: input.artistId },
          object: { entityType: 'artist', entityId: entity.entityId },
          witnessId: entity.witnessId,
          role: entity.role,
          position: null,
        })),
        hasMore: rows.length > limit,
      },
      [
        'Shared recorded album/track credits within the first 50 published releases; not proof of a historical collaboration.',
      ],
    )
  }, withinEvidenceBudget)

  const getMusicResearchSources = Effect.fn('EditorialResearch.sources')(function* (
    input: typeof MusicResearchInput.Type,
  ) {
    yield* authorization.requireScopes(['catalogue:read', 'content:read'])
    const now = yield* Clock.currentTimeMillis
    const session = store.open(now)
    const seed = yield* session.requireEntity(input)
    const links = yield* session.sources(input, input.limit ?? 20)

    return yield* result(
      now,
      { ...empty, entities: [seed], sources: links.rows, hasMore: links.hasMore },
      [
        'Verified stored links only. No provider calls or claims about mutable remote contents. Unsafe stored URLs are omitted.',
      ],
    )
  }, withinEvidenceBudget)

  const getMusicCoverage = Effect.fn('EditorialResearch.coverage')(function* (
    input: typeof MusicResearchInput.Type,
  ) {
    yield* authorization.requireScopes(['catalogue:read', 'content:read'])
    const now = yield* Clock.currentTimeMillis
    const session = store.open(now)
    const seed = yield* session.requireEntity(input)
    const page = yield* session.coverage([input], input.limit ?? 10)

    return yield* result(now, {
      ...empty,
      entities: [seed],
      editorials: page.rows,
      hasMore: page.hasMore,
    })
  }, withinEvidenceBudget)

  const findUndercoveredMusic = Effect.fn('EditorialResearch.undercovered')(function* (
    input: typeof UndercoveredInput.Type,
  ) {
    yield* authorization.requireScopes(['catalogue:read', 'content:read'])
    const now = yield* Clock.currentTimeMillis
    const session = store.open(now)

    const refs: Array<ResearchRef> = [
      ...new Map(input.entities.map((ref) => [`${ref.entityType}:${ref.entityId}`, ref])).values(),
    ]

    const entities = yield* session.getEntities(refs)

    // Do not disclose which selected identity failed publication eligibility.
    if (entities.length !== refs.length) return yield* researchUnavailable()
    const page = yield* session.coverage(refs, 200)

    const coverage = entities
      .map((entity) => {
        const sampledMatches = page.rows.filter(
          (post) =>
            post.music.entityType === entity.entityType && post.music.entityId === entity.entityId,
        ).length

        return {
          music: { entityType: entity.entityType, entityId: entity.entityId },
          sampledMatches,
          status:
            sampledMatches > 0
              ? ('recorded_coverage' as const)
              : ('no_match_in_examined_window' as const),
        }
      })
      .sort((a, b) => a.sampledMatches - b.sampledMatches)

    return yield* result(
      now,
      { ...empty, entities, editorials: page.rows, coverage, hasMore: page.hasMore },
      [
        'Ranks only the selected identities by sampled public structured references; zero is not proof of no coverage.',
      ],
    )
  }, withinEvidenceBudget)

  const findRelatedEditorials = Effect.fn('EditorialResearch.relatedEditorials')(function* (
    input: typeof MusicResearchInput.Type,
  ) {
    yield* authorization.requireScopes(['catalogue:read', 'content:read'])
    const now = yield* Clock.currentTimeMillis
    const session = store.open(now)
    const seed = yield* session.requireEntity(input)
    const window = yield* session.related(input)
    const truncatedEdges = yield* session.seedEdgesTruncated(input)

    const refs = [
      input,
      ...window.slice(0, 200).map((row) => ({
        entityType: row.entityType,
        entityId: row.entityId,
      })),
    ]

    const page = yield* session.coverage(refs, input.limit ?? 10)

    return yield* result(
      now,
      {
        ...empty,
        entities: [seed],
        editorials: page.rows,
        relations: window
          .slice(0, 200)
          .filter((row) =>
            page.rows.some(
              (post) =>
                post.music.entityType === row.entityType && post.music.entityId === row.entityId,
            ),
          )
          .map((row) => ({
            kind: row.kind,
            subject: { entityType: input.entityType, entityId: input.entityId },
            object: { entityType: row.entityType, entityId: row.entityId },
            witnessId: row.witnessId,
            role: null,
            position: null,
          })),
        hasMore: window.length > 200 || page.hasMore || truncatedEdges,
      },
      [
        'Public structured references to this music or the first 200 same-kind related entities, at most 50 seed edges per kind; no draft search or free-text matching.',
      ],
    )
  }, withinEvidenceBudget)

  return {
    exploreGenre,
    exploreLabel,
    findArtistCollaborations,
    getMusicResearchSources,
    getMusicCoverage,
    findUndercoveredMusic,
    findRelatedEditorials,
  }
})

export class EditorialResearchService extends Context.Service<
  EditorialResearchService,
  Effect.Success<typeof makeResearch>
>()('gbfm/mcp/EditorialResearchService') {}

export const EditorialResearchServiceLayer = Layer.effect(
  EditorialResearchService,
  makeResearch,
).pipe(Layer.provide(McpAuthorizationLive), Layer.provide(EditorialEvidenceStoreLayer))
