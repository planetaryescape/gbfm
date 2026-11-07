import type { McpScope } from '@gbfm/core/editorial-mcp'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Match, Option, Result, Schema } from 'effect'

import { audioArtists, audioCreators, audioTable } from '@/db/audio.schema'
import { audioIdsForCreator, postIdsForCreator, showIdsForCreator } from '@/db/creator-membership'
import { buildGuardedPostUpdate } from '@/db/guarded-post-update'
import { Database } from '@/db/layer'
import { postMusicReferencesTable } from '@/db/post-music-reference.schema'
import { postCreators, postsTable } from '@/db/post.schema'
import { showCreators, showsTable } from '@/db/show.schema'
import { entityLabelsTable } from '@/db/tags.schema'
import { McpAuthorization } from '@/mcp/authorization'
import { CommandAuthority } from '@/mcp/command-authority'
import { EndpointIdentity, McpToolError } from '@/mcp/contracts'
import { CreatorCommandResult, DeleteContentInput } from '@/mcp/creator/contracts'
import { EditorialMcpConfig } from '@/mcp/editorial'
import { editorialSnapshotGuard } from '@/mcp/editorial-music/snapshot'
import { McpOperationStore, type OperationPreparation } from '@/mcp/operations/store'

import { buildCreatorUpdate } from './guarded-update'
import { prepareCreatorPostTransition } from './prepare-post'

/** Explicit deletion removes target-owned metadata only, never dependent user/content state. */
const dependencyGuard = (kind: typeof DeleteContentInput.Type.target.kind, id: string): SQL =>
  Match.value(kind).pipe(
    Match.whenOr(
      'post',
      'micro',
      () => sql`NOT EXISTS(SELECT 1 FROM posts p WHERE p.parent_post_id=${id} OR p.root_post_id=${id} OR p.quoted_post_id=${id})
    AND NOT EXISTS(SELECT 1 FROM navigation_trail_entries n WHERE n.postId=${id})
    AND NOT EXISTS(SELECT 1 FROM bluesky_post_sources b WHERE b.post_id=${id})`,
    ),
    Match.when(
      'mix',
      () =>
        sql`NOT EXISTS(SELECT 1 FROM favorites f WHERE f.audio_id=${id}) AND NOT EXISTS(SELECT 1 FROM featured_mix f WHERE f.audio_id=${id})`,
    ),
    Match.when(
      'show',
      () =>
        sql`NOT EXISTS(SELECT 1 FROM audio a WHERE a.showId=${id}) AND NOT EXISTS(SELECT 1 FROM favorites f WHERE f.show_id=${id}) AND NOT EXISTS(SELECT 1 FROM show_subscriptions s WHERE s.showId=${id})`,
    ),
    Match.exhaustive,
  )

const unavailable = () =>
  new McpToolError({
    code: 'unavailable',
    message: 'Deletion unavailable; retry only the identical command.',
  })

const invalid = () =>
  new McpToolError({ code: 'invalid_input', message: 'Invalid deletion command.' })

const Access = Schema.Struct({
  kind: Schema.Literals(['post', 'micro', 'mix', 'show']),
  targetId: Schema.String,
  ownerId: Schema.String,
})

const make = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const store = yield* McpOperationStore
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  const deleteContent = Effect.fn('CreatorCommand.delete')(function* (
    raw: typeof DeleteContentInput.Type,
  ) {
    const input = yield* Schema.decodeUnknownEffect(DeleteContentInput, {
      onExcessProperty: 'error',
    })(raw).pipe(Effect.mapError(invalid))

    const target = input.target

    const scopes: ReadonlyArray<McpScope> = Match.value(target.kind).pipe(
      Match.when('post', () => ['posts:read', 'drafts:write', 'content:delete'] as const),
      Match.when('micro', () => ['micros:publish', 'content:delete'] as const),
      Match.whenOr('mix', 'show', () => ['creator:write', 'content:delete'] as const),
      Match.exhaustive,
    )

    const actor = yield* authorization
      .requireScopes(scopes)
      .pipe(
        Effect.mapError((error) => new McpToolError({ code: error.code, message: error.message })),
      )

    const authorityOption = yield* Effect.serviceOption(CommandAuthority)

    if (Option.isNone(authorityOption))
      return yield* new McpToolError({
        code: 'access_denied',
        message: 'Command authority required.',
      })
    const authority = authorityOption.value
    const initial = yield* authority.checkpoint(scopes)

    if (initial.actorId !== actor.userId)
      return yield* new McpToolError({ code: 'access_denied', message: 'Command access denied.' })
    const now = yield* Clock.currentTimeMillis
    const run = Effect.runPromiseWith(yield* Effect.context())
    let checkpoint = initial
    const dependencies = dependencyGuard(target.kind, target.targetId)

    const result = yield* Effect.tryPromise({
      try: () =>
        store.execute({
          key: {
            actorId: initial.actorId,
            clientId: initial.clientId,
            resource: initial.resource,
            operation: 'delete_content',
            requestId: input.requestId,
          },
          normalizedInput: input,
          now,
          authorize: async (outcome) => {
            const checked = await run(Effect.result(authority.checkpoint(scopes)))

            if (Result.isFailure(checked)) {
              if (checked.failure.code === 'access_denied') return false
              throw checked.failure
            }

            checkpoint = checked.success

            if (
              checkpoint.actorId !== initial.actorId ||
              checkpoint.clientId !== initial.clientId ||
              checkpoint.resource !== initial.resource
            )
              return false

            if (!outcome) return true

            if (
              !Schema.is(Access)(outcome.access) ||
              outcome.access.kind !== target.kind ||
              outcome.access.targetId !== target.targetId ||
              outcome.access.ownerId !== actor.userId
            )
              return false

            if (target.kind === 'post' || target.kind === 'micro') {
              const [row] = await db
                .select({ id: postsTable.id, type: postsTable.type })
                .from(postsTable)
                .where(eq(postsTable.id, target.targetId))
                .limit(1)

              if (!row) return true

              if (row.type !== target.kind && !(target.kind === 'post' && row.type === null))
                return false

              return (
                (
                  await db
                    .select({ id: postsTable.id })
                    .from(postsTable)
                    .where(
                      and(eq(postsTable.id, target.targetId), postIdsForCreator(db, actor.userId)),
                    )
                    .limit(1)
                ).length === 1
              )
            }

            const table = target.kind === 'mix' ? audioTable : showsTable

            if (
              (
                await db
                  .select({ id: table.id })
                  .from(table)
                  .where(eq(table.id, target.targetId))
                  .limit(1)
              ).length === 0
            )
              return true

            return (
              (
                await db
                  .select({ id: table.id })
                  .from(table)
                  .where(
                    and(
                      eq(table.id, target.targetId),
                      target.kind === 'mix'
                        ? audioIdsForCreator(db, actor.userId)
                        : showIdsForCreator(db, actor.userId),
                      target.kind === 'mix' ? eq(audioTable.type, 'mix') : undefined,
                    ),
                  )
                  .limit(1)
              ).length === 1
            )
          },
          prepare: async (): Promise<OperationPreparation> => {
            if (target.kind === 'post' || target.kind === 'micro') {
              const prepared = await run(
                Effect.result(
                  prepareCreatorPostTransition({
                    postId: target.targetId,
                    actorId: actor.userId,
                    expectedVersion: target.expectedVersion,
                    transition: 'delete',
                    now: new Date(now),
                  }).pipe(
                    Effect.provideService(Database, db),
                    Effect.provideService(EditorialMcpConfig, config),
                  ),
                ),
              )

              if (Result.isFailure(prepared)) {
                const code = prepared.failure.code

                return {
                  status: code === 'not_found' || code === 'conflict' ? code : 'unavailable',
                }
              }

              const { snapshot, patch, version } = prepared.success

              if (
                snapshot.type !== target.kind &&
                !(target.kind === 'post' && snapshot.type === null)
              )
                return { status: 'not_found' }

              return {
                status: 'ready',
                build: (ctx) => {
                  const save = buildGuardedPostUpdate(
                    db,
                    snapshot,
                    actor.userId,
                    patch,
                    undefined,
                    [],
                    {
                      guard: and(ctx.fence, dependencies, editorialSnapshotGuard(snapshot)),
                      liveGuard: checkpoint.liveGuard,
                      allowAdmin: false,
                      attemptId: ctx.attemptId,
                      now: patch.updatedAt,
                    },
                  )

                  const authorized = and(ctx.fence, save.authorized)

                  return {
                    statements: [
                      ctx.prepare(save.update.getSQL()),
                      ctx.prepare(
                        db
                          .delete(postMusicReferencesTable)
                          .where(
                            and(eq(postMusicReferencesTable.postId, target.targetId), authorized),
                          )
                          .getSQL(),
                      ),
                      ctx.prepare(
                        db
                          .delete(entityLabelsTable)
                          .where(
                            and(
                              eq(entityLabelsTable.entityType, 'post'),
                              eq(entityLabelsTable.entityId, target.targetId),
                              authorized,
                            ),
                          )
                          .getSQL(),
                      ),
                      ctx.prepare(
                        db
                          .delete(postCreators)
                          .where(and(eq(postCreators.postId, target.targetId), authorized))
                          .getSQL(),
                      ),
                      ctx.assert(sql`${authorized} AND ${dependencies}`),
                      ctx.prepare(
                        db
                          .delete(postsTable)
                          .where(and(eq(postsTable.id, target.targetId), authorized))
                          .getSQL(),
                      ),
                    ],
                    assertApplied: sql`${ctx.fence} AND ${checkpoint.liveGuard} AND NOT EXISTS(SELECT 1 FROM posts WHERE id=${target.targetId})`,
                    outcome: {
                      result: {
                        kind: target.kind,
                        targetId: target.targetId,
                        version,
                        state: 'deleted',
                      },
                      revision: version,
                      access: {
                        kind: target.kind,
                        targetId: target.targetId,
                        ownerId: actor.userId,
                      },
                    },
                  }
                },
              }
            }

            if (!('expectedRevision' in target)) return { status: 'invalid_input' }
            const table = target.kind === 'mix' ? audioTable : showsTable

            const membership =
              target.kind === 'mix'
                ? audioIdsForCreator(db, actor.userId)
                : showIdsForCreator(db, actor.userId)

            const [row] = await db
              .select({
                id: table.id,
                revision: table.revision,
                draft: table.draft,
                updatedAt: table.updatedAt,
              })
              .from(table)
              .where(
                and(
                  eq(table.id, target.targetId),
                  membership,
                  target.kind === 'mix' ? eq(audioTable.type, 'mix') : undefined,
                ),
              )
              .limit(1)

            if (!row) return { status: 'not_found' }

            if (
              row.revision !== target.expectedRevision ||
              row.revision === Number.MAX_SAFE_INTEGER
            )
              return { status: 'conflict' }

            return {
              status: 'ready',
              build: (ctx) => {
                const save = buildCreatorUpdate(
                  db,
                  target.kind === 'mix' ? 'audio' : 'show',
                  row,
                  actor.userId,
                  {},
                  {
                    attemptId: ctx.attemptId,
                    now: new Date(Math.max(now, row.updatedAt.getTime() + 1)),
                    guard: and(
                      ctx.fence,
                      dependencies,
                      target.kind === 'mix' ? eq(audioTable.type, 'mix') : undefined,
                    ),
                    liveGuard: checkpoint.liveGuard,
                  },
                )

                const authorized = and(ctx.fence, save.authorized)
                const owned = target.kind === 'mix' ? audioCreators : showCreators

                const ownerTarget =
                  target.kind === 'mix' ? audioCreators.audioId : showCreators.showId

                const statements = [
                  ctx.prepare(save.update.getSQL()),
                  ctx.prepare(
                    db
                      .delete(entityLabelsTable)
                      .where(
                        and(
                          eq(
                            entityLabelsTable.entityType,
                            target.kind === 'mix' ? 'audio' : 'show',
                          ),
                          eq(entityLabelsTable.entityId, row.id),
                          authorized,
                        ),
                      )
                      .getSQL(),
                  ),
                  ctx.prepare(
                    db
                      .delete(owned)
                      .where(and(eq(ownerTarget, row.id), authorized))
                      .getSQL(),
                  ),
                ]

                if (target.kind === 'mix')
                  statements.push(
                    ctx.prepare(
                      db
                        .delete(audioArtists)
                        .where(and(eq(audioArtists.audioId, row.id), authorized))
                        .getSQL(),
                    ),
                  )
                statements.push(
                  ctx.assert(sql`${authorized} AND ${dependencies}`),
                  ctx.prepare(
                    db
                      .delete(table)
                      .where(and(eq(table.id, row.id), authorized))
                      .getSQL(),
                  ),
                )

                return {
                  statements,
                  assertApplied: sql`${ctx.fence} AND ${checkpoint.liveGuard} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE ${table.id}=${row.id})`,
                  outcome: {
                    result: {
                      kind: target.kind,
                      targetId: row.id,
                      revision: row.revision + 1,
                      state: 'deleted',
                    },
                    revision: row.revision + 1,
                    access: { kind: target.kind, targetId: row.id, ownerId: actor.userId },
                  },
                }
              },
            }
          },
        }),
      catch: unavailable,
    })

    if (result.status !== 'applied' && result.status !== 'replayed')
      return yield* new McpToolError({
        code: result.status,
        message: 'Deletion did not return an applied outcome.',
      })

    return yield* Schema.decodeUnknownEffect(CreatorCommandResult)({
      endpoint,
      status: 'applied',
      replayed: result.status === 'replayed',
      target: result.outcome.result,
    }).pipe(Effect.mapError(unavailable))
  })

  return { deleteContent }
})

export class CreatorDeleteCommands extends Context.Service<
  CreatorDeleteCommands,
  Effect.Success<typeof make>
>()('gbfm/CreatorDeleteCommands') {}

export const CreatorDeleteCommandsLayer = Layer.effect(CreatorDeleteCommands, make)
