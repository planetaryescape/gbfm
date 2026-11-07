import { and, eq, sql, type SQL } from 'drizzle-orm'
import { Effect, Option } from 'effect'

import { audioTable } from '@/db/audio.schema'
import { Database } from '@/db/layer'
import { showsTable } from '@/db/show.schema'
import { entityLabelsTable } from '@/db/tags.schema'
import { ConflictError, DatabaseError, UnauthorizedError, getErrorMessage } from '@/errors'
import { CommandAuthority } from '@/mcp/command-authority'
import { prepareOperationStatement } from '@/mcp/operations/persistence'
import { ConfigService } from '@/services/config.service'
import { attachedMediaUrls } from '@/services/media-publication'
import { keyFromAssetUrl } from '@/services/upload-asset.service'

import { buildCreatorUpdate } from './guarded-update'

// SQLite CASE evaluates only the selected branch. Integer overflow aborts D1's entire batch,
// including earlier writes and trigger effects; a returned false/zero-row SELECT would not.
const assertBatch = (predicate: SQL) =>
  sql`SELECT CASE WHEN (${predicate}) THEN 1 ELSE abs(-9223372036854775808) END`

/** Legacy callers omit expectedRevision and receive source-load CAS, not stale-intent protection. */
export const saveCreatorBrowserUpdate = Effect.fn('CreatorCommand.browserSave')(function* (
  ...[kind, previous, actorId, data, options]: [
    Parameters<typeof buildCreatorUpdate>[1],
    Parameters<typeof buildCreatorUpdate>[2],
    string,
    Parameters<typeof buildCreatorUpdate>[4],
    Omit<Parameters<typeof buildCreatorUpdate>[5], 'attemptId' | 'liveGuard'> & {
      readonly expectedRevision?: number | undefined
    },
  ]
) {
  const db = yield* Database
  const config = yield* ConfigService
  const authority = yield* Effect.serviceOption(CommandAuthority)
  const denied = () => new UnauthorizedError({ message: 'Content access denied.' })

  // Existing in-process service callers already supply an authenticated actor. HTTP adapters
  // additionally pin their live session; MCP never enters this compatibility path.
  const checkpoint = Option.isSome(authority)
    ? yield* authority.value.checkpoint([]).pipe(Effect.mapError(denied))
    : { actorId, liveGuard: sql`EXISTS(SELECT 1 FROM user u WHERE u.id=${actorId} AND u.banned=0)` }

  const conflict = () => new ConflictError({ message: 'Content changed; reload before saving.' })

  if (
    checkpoint.actorId !== actorId ||
    (options.expectedRevision !== undefined && options.expectedRevision !== previous.revision) ||
    previous.revision === Number.MAX_SAFE_INTEGER
  )
    return yield* conflict()

  const save = buildCreatorUpdate(db, kind, previous, actorId, data, {
    ...options,
    attemptId: crypto.randomUUID(),
    liveGuard: checkpoint.liveGuard,
    assetKeys: attachedMediaUrls(data).flatMap((url) => {
      const key = keyFromAssetUrl(url, config.urls.bucketRouter)

      return key === null ? [] : [key.startsWith('public/') ? `private/${key.slice(7)}` : key]
    }),
  })

  yield* Effect.tryPromise({
    try: () =>
      db.$client.batch(
        [save.update.getSQL(), ...save.writes, assertBatch(sql`${save.authorized}`)].map(
          (statement) => prepareOperationStatement(db.$client, statement),
        ),
      ),
    catch: (cause) =>
      getErrorMessage(cause).includes('integer overflow')
        ? conflict()
        : new DatabaseError({
            message: 'Failed atomic content save',
            operation: 'transaction',
            table: kind,
          }),
  })

  return undefined
})

/** Preserve legacy show deletion while versioning every episode detached by its SET NULL effect. */
export const deleteCreatorBrowserShow = Effect.fn('CreatorCommand.browserDeleteShow')(function* (
  previous: typeof showsTable.$inferSelect,
  actorId: string,
) {
  const db = yield* Database
  const authority = yield* Effect.serviceOption(CommandAuthority)
  const denied = () => new UnauthorizedError({ message: 'Content access denied.' })

  const checkpoint = Option.isSome(authority)
    ? yield* authority.value.checkpoint([]).pipe(Effect.mapError(denied))
    : { actorId, liveGuard: sql`EXISTS(SELECT 1 FROM user u WHERE u.id=${actorId} AND u.banned=0)` }

  if (checkpoint.actorId !== actorId) return yield* denied()
  const conflict = () => new ConflictError({ message: 'Content changed; reload before deleting.' })

  if (previous.revision === Number.MAX_SAFE_INTEGER) return yield* conflict()
  const now = new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1))
  const attemptId = crypto.randomUUID()

  const save = buildCreatorUpdate(
    db,
    'show',
    previous,
    actorId,
    {},
    {
      attemptId,
      now,
      allowAdmin: true,
      liveGuard: checkpoint.liveGuard,
      guard: sql`NOT EXISTS(SELECT 1 FROM audio a WHERE a.showId=${previous.id} AND a.revision>=${Number.MAX_SAFE_INTEGER})`,
    },
  )

  const statements = [
    save.update.getSQL(),
    db
      .delete(entityLabelsTable)
      .where(
        and(
          eq(entityLabelsTable.entityType, 'show'),
          eq(entityLabelsTable.entityId, previous.id),
          save.authorized,
        ),
      )
      .getSQL(),
    db
      .update(audioTable)
      .set({
        showId: null,
        revision: sql`${audioTable.revision}+1`,
        lastOperationId: attemptId,
        updatedAt: sql`max(${audioTable.updatedAt}+1,${now.getTime()})`,
      })
      .where(and(eq(audioTable.showId, previous.id), save.authorized))
      .getSQL(),
    assertBatch(sql`${save.authorized}`),
    db
      .delete(showsTable)
      .where(and(eq(showsTable.id, previous.id), save.authorized))
      .returning({ id: showsTable.id })
      .getSQL(),
    assertBatch(
      sql`${checkpoint.liveGuard} AND NOT EXISTS(SELECT 1 FROM shows WHERE id=${previous.id})`,
    ),
  ]

  yield* Effect.tryPromise({
    try: () =>
      db.$client.batch(
        statements.map((statement) => prepareOperationStatement(db.$client, statement)),
      ),
    catch: (cause) =>
      getErrorMessage(cause).includes('integer overflow')
        ? conflict()
        : new DatabaseError({
            message: 'Failed atomic show deletion',
            operation: 'transaction',
            table: 'shows',
          }),
  })

  return undefined
})
