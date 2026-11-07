import { EDITORIAL_DRAFT_RETRY_WINDOW_MS, PostId, type McpScope } from '@gbfm/core/editorial-mcp'
import type { UserId } from '@gbfm/core/identity'
import type { DraftMusicReferences } from '@gbfm/core/post-music-references'
import { and, eq, exists, inArray, sql, type SQL } from 'drizzle-orm'
import { Clock, Effect, Option, Schema } from 'effect'

import { user } from '@/db/auth.schema'
import { editorialOperations } from '@/db/editorial-operation.schema'
import { buildGuardedPostUpdate } from '@/db/guarded-post-update'
import type { DatabaseClient } from '@/db/layer'
import { postsTable, type InsertPost } from '@/db/post.schema'

import { CommandAuthority } from '../command-authority'
import { EditorialToolError } from '../contracts'
import { notFound, unavailable } from '../model'
import { boundEditorialResult } from './content'
import { editorialSnapshotGuard, loadEditorialSnapshot, type EditorialSnapshot } from './snapshot'

/** Request context is resolved at execution, never when the shared service layer is constructed. */
export const checkpointEditorialCommand = Effect.fn('EditorialCommand.checkpoint')(function* (
  scopes: ReadonlyArray<McpScope>,
  actorId: UserId,
) {
  const authority = yield* Effect.serviceOption(CommandAuthority)

  const denied = () =>
    new EditorialToolError({ code: 'access_denied', message: 'Command access denied.' })

  if (Option.isNone(authority)) return yield* denied()

  const checkpoint = yield* authority.value
    .checkpoint(scopes)
    .pipe(Effect.mapError((error) => (error.code === 'unavailable' ? unavailable() : denied())))

  if (checkpoint.actorId !== actorId) return yield* denied()

  return checkpoint
})

/** A failed CAS or reused operation key is not retried as a new edit. */
export const editorialConflict = () =>
  new EditorialToolError({
    code: 'conflict',
    message: 'Draft changed or requestId was reused. Read the draft before retrying.',
  })

/** Authored fields only. Omitted musicReferences preserves the entire collection and managed marker. */
export interface EditorialPatch {
  readonly title?: string | undefined
  readonly content?: string | undefined
  readonly description?: string | null | undefined
  readonly tags?: ReadonlyArray<string>
  readonly musicReferences?: DraftMusicReferences
  readonly managed?: boolean
}

const digest = (value: string) =>
  Effect.tryPromise({
    try: async () => {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))

      return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      )
    },
    catch: unavailable,
  })

/** Retains shipped actor/requestId keys; discriminator and normalized presence-aware input belong in inputHash. */
export const editorialOperationKeys = (
  actorId: UserId,
  requestId: string,
  normalizedInput: string,
) =>
  Effect.all({
    id: digest(JSON.stringify([actorId, requestId])),
    inputHash: digest(normalizedInput),
  })

/** Current ownership and unpublished editorial state apply to writes AND original-result replay. */
export const loadOwnedEditorialDraft = (db: DatabaseClient, postId: PostId, actorId: UserId) =>
  loadEditorialSnapshot(db, postId).pipe(
    Effect.flatMap((post) =>
      post.draft && post.type === 'post' && post.creators?.some((creator) => creator.id === actorId)
        ? Effect.succeed(post)
        : Effect.fail(notFound()),
    ),
  )

/** Operation-specific receipt decoder; caller supplies live scope/role checks and a subtraction-only mask. */
export const replayEditorialOperation = <A extends { readonly post: { readonly postId: PostId } }>(
  db: DatabaseClient,
  actorId: UserId,
  key: { readonly id: string; readonly inputHash: string },
  resultSchema: Schema.Codec<A, unknown>,
  authorize: Effect.Effect<unknown, EditorialToolError>,
  mask: (result: A) => Effect.Effect<A, EditorialToolError> = Effect.succeed,
) =>
  Effect.gen(function* () {
    yield* authorize

    const [row] = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(editorialOperations)
          .where(and(eq(editorialOperations.id, key.id), eq(editorialOperations.actorId, actorId)))
          .limit(1),
      catch: unavailable,
    })

    if (!row) return Option.none<A>()

    if (row.inputHash !== key.inputHash) return yield* editorialConflict()

    // Check post access even for an expired/redacted receipt so a tombstone cannot disclose ownership.
    const postId = yield* Schema.decodeUnknownEffect(PostId)(row.postId).pipe(
      Effect.mapError(unavailable),
    )

    yield* loadOwnedEditorialDraft(db, postId, actorId)

    if (
      row.result === null ||
      (yield* Clock.currentTimeMillis) >= row.createdAt.getTime() + EDITORIAL_DRAFT_RETRY_WINDOW_MS
    )
      return yield* new EditorialToolError({
        code: 'expired',
        message:
          'The 24-hour retry window expired. Read the current draft and use a new requestId for a new edit.',
      })

    const result = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(resultSchema))(
      row.result,
    ).pipe(Effect.mapError(unavailable))

    if (result.post.postId !== postId) return yield* unavailable()
    const masked = yield* mask(result)
    yield* authorize
    yield* loadOwnedEditorialDraft(db, postId, actorId)

    return Option.some(yield* boundEditorialResult(masked))
  })

/**
 * One D1 batch: full-snapshot CAS first, then all coupled writes and the saved receipt fenced by a
 * fresh physical attempt UUID. No changes() dependency and no second operation ledger.
 */
export const saveEditorialChange = (
  db: DatabaseClient,
  actorId: UserId,
  previous: EditorialSnapshot,
  patch: EditorialPatch,
  receipt: typeof editorialOperations.$inferInsert & { readonly result: string },
  targetGuard: SQL | undefined,
  liveGuard: SQL,
) =>
  Effect.gen(function* () {
    if (new TextEncoder().encode(receipt.result).byteLength > 256 * 1024)
      return yield* new EditorialToolError({
        code: 'invalid_input',
        message: 'Editorial result exceeds the supported limit.',
      })
    const attemptId = crypto.randomUUID()

    const eligible = exists(
      db
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            eq(user.id, actorId),
            inArray(user.role, ['creator', 'editor', 'admin']),
            sql`coalesce(${user.banned}, 0) = 0`,
          ),
        ),
    )

    const { musicReferences, managed, tags, ...fields } = patch
    const data: Partial<InsertPost> = { ...fields }

    if (musicReferences !== undefined) {
      data.musicEntityType = musicReferences.primary?.entityType ?? null
      data.musicEntityId = musicReferences.primary?.entityId ?? null
      data.musicReferencesManaged = managed ?? true
    }

    const save = buildGuardedPostUpdate(db, previous, actorId, data, tags, [], {
      attemptId,
      liveGuard,
      musicReferences,
      now: receipt.createdAt,
      guard: and(
        editorialSnapshotGuard(previous),
        eq(postsTable.draft, true),
        eq(postsTable.type, 'post'),
        eligible,
        targetGuard,
        sql`NOT EXISTS (SELECT 1 FROM ${editorialOperations} WHERE ${editorialOperations.id} = ${receipt.id})`,
      ),
    })

    const receiptWrite = db.insert(editorialOperations).select(
      db
        .select({
          id: sql<string>`${receipt.id}`.as('id'),
          actorId: sql<string>`${actorId}`.as('actor_id'),
          postId: sql<string>`${previous.id}`.as('post_id'),
          inputHash: sql<string>`${receipt.inputHash}`.as('input_hash'),
          result: sql<string>`${receipt.result}`.as('result'),
          createdAt: sql<Date>`${receipt.createdAt.getTime()}`.as('created_at'),
        })
        .from(sql`(SELECT 1)`)
        .where(save.authorized),
    )

    const [updated] = yield* Effect.tryPromise({
      try: () =>
        db.batch([
          save.update,
          ...save.writes,
          receiptWrite,
          db
            .select({
              assertion: sql<number>`CASE WHEN NOT (${save.winner}) OR ((${save.authorized}) AND EXISTS (
        SELECT 1 FROM ${editorialOperations} WHERE ${editorialOperations.id} = ${receipt.id}
        AND ${editorialOperations.inputHash} = ${receipt.inputHash}
      )) THEN 1 ELSE json('editorial receipt assertion failed') END`,
            })
            .from(sql`(SELECT 1)`),
        ]),
      catch: unavailable,
    })

    return updated.length > 0
  })
