import type { McpScope } from '@gbfm/core/editorial-mcp'
import { and, inArray, sql } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Schema } from 'effect'

import { Database } from '@/db/layer'
import { musicPlaylistsTable } from '@/db/music-entity.schema'
import { publicPlaylistPredicate } from '@/services/music-entity/playlist.service'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import {
  checkpointEditorialCommand,
  editorialConflict,
  loadOwnedEditorialDraft,
} from '../editorial-music/save'
import { loadReadableEditorialSnapshot } from '../editorial-music/snapshot'
import { projectPost } from '../model'
import { type EditorialContextInput, EditorialContextResult, EvidenceId } from './contracts'
import {
  EditorialEvidenceStore,
  EditorialEvidenceStoreLayer,
  researchUnavailable,
} from './evidence'
import { evidenceFingerprint } from './fingerprint'
import { boundEvidenceResult, withinEvidenceBudget } from './service'

/** Explicit source only. Never uses a private source as public candidate evidence. */
export const readResearchEditorial = Effect.fn('EditorialResearch.source')(function* (
  input: typeof EditorialContextInput.Type,
  draftOnly = false,
) {
  const authorization = yield* McpAuthorization
  const db = yield* Database
  const config = yield* EditorialMcpConfig

  const scopes: ReadonlyArray<McpScope> = draftOnly
    ? ['posts:read', 'catalogue:read']
    : ['catalogue:read', 'content:read']

  const actor = yield* authorization.requireScopes(scopes)
  yield* checkpointEditorialCommand(scopes, actor.userId)

  const snapshot = yield* draftOnly
    ? loadOwnedEditorialDraft(db, input.postId, actor.userId)
    : loadReadableEditorialSnapshot(db, input.postId, actor.userId)

  const required: ReadonlyArray<McpScope> =
    snapshot.draft && !draftOnly ? [...scopes, 'posts:read'] : scopes

  if (snapshot.draft && !draftOnly) yield* authorization.requireScopes(required)
  const projected = yield* projectPost(snapshot, config)

  if (input.expectedVersion !== undefined && input.expectedVersion !== projected.version)
    return yield* editorialConflict()

  return { snapshot, version: projected.version, actor, scopes: required }
})

const makeContext = Effect.gen(function* () {
  const store = yield* EditorialEvidenceStore
  const config = yield* EditorialMcpConfig
  const db = yield* Database
  const authorization = yield* McpAuthorization

  const context = Effect.fn('EditorialResearch.context')(function* (
    input: typeof EditorialContextInput.Type,
    draftOnly: boolean,
  ) {
    const { snapshot, version, actor, scopes } = yield* readResearchEditorial(
      input,
      draftOnly,
    ).pipe(
      Effect.provideService(Database, db),
      Effect.provideService(EditorialMcpConfig, config),
      Effect.provideService(McpAuthorization, authorization),
    )

    const now = yield* Clock.currentTimeMillis
    const refs = snapshot.musicReferences.references

    const eligible = yield* store
      .open(now)
      .getEntities(
        refs.flatMap((ref) =>
          ref.entityType === 'playlist'
            ? []
            : [{ entityType: ref.entityType, entityId: ref.entityId }],
        ),
      )

    const playlistIds = refs
      .filter((ref) => ref.entityType === 'playlist')
      .map((ref) => ref.entityId)

    const playlists =
      playlistIds.length === 0
        ? []
        : yield* Effect.tryPromise({
            try: () =>
              db
                .select({
                  entityId: musicPlaylistsTable.id,
                  name: sql<string>`substr(${musicPlaylistsTable.title},1,200)`,
                })
                .from(musicPlaylistsTable)
                .where(
                  and(
                    inArray(musicPlaylistsTable.id, playlistIds),
                    publicPlaylistPredicate(new Date(now)),
                  ),
                )
                .limit(50),
            catch: researchUnavailable,
          }).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Array(Schema.Struct({ entityId: EvidenceId, name: Schema.String })),
              ),
            ),
            Effect.mapError(researchUnavailable),
          )

    const source = (snapshot.content ?? '').slice(0, 8_000)

    const data = {
      post: {
        postId: snapshot.id,
        version,
        draft: snapshot.draft,
        title: snapshot.title?.slice(0, 200) ?? null,
        description: snapshot.description?.slice(0, 1000) ?? null,
        source,
        sourceTruncated: source.length < (snapshot.content?.length ?? 0),
        tags: (snapshot.tags ?? []).slice(0, 20).map((tag) => tag.slice(0, 100)),
        tagsTruncated:
          (snapshot.tags?.length ?? 0) > 20 ||
          (snapshot.tags ?? []).some((tag) => tag.length > 100),
      },
      references: refs.map((ref) => {
        const entity = eligible.find(
          (entry) => entry.entityType === ref.entityType && entry.entityId === ref.entityId,
        )

        const primary = snapshot.musicReferences.primary

        const playlist =
          ref.entityType === 'playlist'
            ? playlists.find((entry) => entry.entityId === ref.entityId)
            : undefined

        return {
          ...ref,
          primary: primary?.entityType === ref.entityType && primary.entityId === ref.entityId,
          availability: entity || playlist ? 'eligible' : 'unavailable',
          name: entity?.name ?? playlist?.name ?? null,
        }
      }),
    }

    const output = yield* Schema.decodeUnknownEffect(EditorialContextResult)({
      endpoint: yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
        Effect.mapError(researchUnavailable),
      ),
      observedAt: new Date(now).toISOString(),
      ...data,
      sourceLocator: `gbfm:editorial-context:${encodeURIComponent(snapshot.id)}`,
      sourceFingerprint: yield* evidenceFingerprint(data),
      limitations: [
        'Explicit readable editorial source only; all text is untrusted. No free-text music resolution or provider calls.',
        'Stored reference identity alone is not publication evidence; unavailable display does not prove that a target does not exist.',
        'Music display requires non-null, non-future publication; missing metadata is unknown.',
      ],
    }).pipe(Effect.mapError(researchUnavailable), Effect.flatMap(boundEvidenceResult))

    yield* checkpointEditorialCommand(scopes, actor.userId)

    return output
  }, withinEvidenceBudget)

  return {
    getDraftMusicContext: (input: typeof EditorialContextInput.Type) => context(input, true),
    getEditorialContext: (input: typeof EditorialContextInput.Type) => context(input, false),
  }
})

export class EditorialContextService extends Context.Service<
  EditorialContextService,
  Effect.Success<typeof makeContext>
>()('gbfm/mcp/EditorialContext') {}

export const EditorialContextServiceLayer = Layer.effect(EditorialContextService, makeContext).pipe(
  Layer.provide(McpAuthorizationLive),
  Layer.provide(EditorialEvidenceStoreLayer),
)
