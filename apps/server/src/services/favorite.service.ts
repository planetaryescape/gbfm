import {
  MembershipRevision,
  type MembershipStateResponse,
  type MembershipTargetKind,
} from '@gbfm/api/favorites'
import { and, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { Context, Effect, Layer, Schema } from 'effect'

import { audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import { favoritesTable } from '@/db/favorites.schema'
import { Database } from '@/db/layer'
import { listenerMembershipRevisions } from '@/db/listening.schema'
import { showSubscriptionsTable, showsTable } from '@/db/show.schema'
import { DatabaseError, getErrorMessage, NotFoundError } from '@/errors'
import { executeMembership, type MembershipWriteContext } from '@/mcp/favorites/membership'
import { McpOperationStore, type OperationResult } from '@/mcp/operations/store'

const audioShowsTable = alias(showsTable, 'audio_shows')

const MembershipPage = Schema.Struct({
  revision: MembershipRevision,
  items: Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literals(['mix', 'track', 'misc', 'show']),
        id: Schema.String,
        title: Schema.String,
        slug: Schema.String,
      }),
    ),
  ),
})

type FavoriteWithContent = {
  id: string
  userId: string
  audioId: string | null
  showId: string | null
  membershipRevision: number
  createdAt: Date
  audio: {
    id: string
    title: string
    slug: string
    thumbnailUrl: string | null
    type: 'mix' | 'track' | 'misc'
    url: string
  } | null
  show: { id: string; title: string; slug: string; thumbnailUrl: string | null } | null
}

type FavoriteWrite = (
  context: MembershipWriteContext,
  targetId: string,
) => Effect.Effect<OperationResult, never, McpOperationStore>

export interface FavoriteService {
  readonly getMembershipPage: (
    userId: string,
    kind: 'favorites' | 'subscriptions',
    limit: number,
    offset: number,
  ) => Effect.Effect<typeof MembershipPage.Type, DatabaseError>
  readonly getMembershipState: (
    userId: string,
    targetKind: typeof MembershipTargetKind.Type,
    targetId: string,
  ) => Effect.Effect<typeof MembershipStateResponse.Type, DatabaseError | NotFoundError>
  readonly hasAudioFavorite: (
    userId: string,
    audioId: string,
  ) => Effect.Effect<boolean, DatabaseError>
  readonly addFavorite: FavoriteWrite
  readonly addShowFavorite: FavoriteWrite
  readonly removeFavorite: FavoriteWrite
  readonly removeShowFavorite: FavoriteWrite
  readonly getFavorites: (
    userId: string,
    limit?: number,
    offset?: number,
  ) => Effect.Effect<Array<FavoriteWithContent>, DatabaseError>
}

export const FavoriteService = Context.Service<FavoriteService>('FavoriteService')

const getMembershipPageEffect = Effect.fn('favorite.membershipPage')(function* (
  userId: string,
  kind: 'favorites' | 'subscriptions',
  limit: number,
  offset: number,
) {
  const db = yield* Database

  // The aggregate always returns one row, even for an empty/out-of-range page.
  // Revision and bounded public summaries therefore share a single D1 observation.
  const page =
    kind === 'favorites'
      ? sql`SELECT COALESCE(${audioTable.type}, 'show') AS kind,
        COALESCE(${audioTable.id}, ${showsTable.id}) AS id,
        COALESCE(${audioTable.title}, ${showsTable.title}) AS title,
        COALESCE(${audioTable.slug}, ${showsTable.slug}) AS slug
      FROM ${favoritesTable}
      LEFT JOIN ${audioTable} ON ${favoritesTable.audioId} = ${audioTable.id}
      LEFT JOIN ${showsTable} ON ${favoritesTable.showId} = ${showsTable.id}
      WHERE ${favoritesTable.userId} = ${userId} AND (
        (${favoritesTable.audioId} IS NOT NULL AND ${favoritesTable.showId} IS NULL AND ${audioTable.draft} = 0) OR
        (${favoritesTable.showId} IS NOT NULL AND ${favoritesTable.audioId} IS NULL AND ${showsTable.draft} = 0))
      ORDER BY ${favoritesTable.createdAt} DESC, ${favoritesTable.id} DESC LIMIT ${limit} OFFSET ${offset}`
      : sql`SELECT 'show' AS kind, ${showsTable.id} AS id, ${showsTable.title} AS title, ${showsTable.slug} AS slug
      FROM ${showSubscriptionsTable} JOIN ${showsTable} ON ${showSubscriptionsTable.showId} = ${showsTable.id}
      WHERE ${showSubscriptionsTable.userId} = ${userId} AND ${showsTable.draft} = 0
      ORDER BY ${showSubscriptionsTable.createdAt} DESC, ${showSubscriptionsTable.id} DESC LIMIT ${limit} OFFSET ${offset}`

  const rows = yield* Effect.tryPromise({
    try: () =>
      db.all(sql`SELECT COALESCE((SELECT ${listenerMembershipRevisions.revision}
        FROM ${listenerMembershipRevisions} WHERE ${listenerMembershipRevisions.userId} = ${userId}),0) AS revision,
      (SELECT json_group_array(json_object('kind',kind,'id',id,'title',title,'slug',slug)) FROM (${page})) AS items`),
    catch: () =>
      new DatabaseError({
        message: 'Failed to read membership page',
        operation: 'select',
        table: 'favorites',
      }),
  })

  return yield* Schema.decodeUnknownEffect(MembershipPage)(rows[0]).pipe(
    Effect.mapError(
      () =>
        new DatabaseError({
          message: 'Invalid membership page',
          operation: 'select',
          table: 'favorites',
        }),
    ),
  )
})

const getFavoritesEffect = (
  userId: string,
  limit = 20,
  offset = 0,
): Effect.Effect<Array<FavoriteWithContent>, DatabaseError, Database> =>
  Effect.withSpan('favorite.get', { attributes: { limit, offset } })(
    Effect.gen(function* () {
      const db = yield* Database

      const favorites = yield* Effect.tryPromise({
        try: () =>
          db
            .select({
              id: favoritesTable.id,
              userId: favoritesTable.userId,
              audioId: favoritesTable.audioId,
              showId: favoritesTable.showId,
              membershipRevision: sql<number>`COALESCE((SELECT ${listenerMembershipRevisions.revision} FROM ${listenerMembershipRevisions} WHERE ${listenerMembershipRevisions.userId} = ${userId}), 0)`,
              createdAt: favoritesTable.createdAt,
              audio: {
                id: audioTable.id,
                title: audioTable.title,
                slug: audioTable.slug,
                thumbnailUrl: audioTable.thumbnailUrl,
                type: audioTable.type,
                url: audioTable.url,
              },
              audioShowThumbnailUrl: audioShowsTable.thumbnailUrl,
              show: {
                id: showsTable.id,
                title: showsTable.title,
                slug: showsTable.slug,
                thumbnailUrl: showsTable.thumbnailUrl,
              },
            })
            .from(favoritesTable)
            .leftJoin(audioTable, eq(favoritesTable.audioId, audioTable.id))
            .leftJoin(showsTable, eq(favoritesTable.showId, showsTable.id))
            .leftJoin(
              audioShowsTable,
              and(eq(audioTable.showId, audioShowsTable.id), eq(audioShowsTable.draft, false)),
            )
            .where(
              and(
                eq(favoritesTable.userId, userId),
                or(
                  and(
                    isNotNull(favoritesTable.audioId),
                    isNull(favoritesTable.showId),
                    eq(audioTable.draft, false),
                  ),
                  and(
                    isNotNull(favoritesTable.showId),
                    isNull(favoritesTable.audioId),
                    eq(showsTable.draft, false),
                  ),
                ),
              ),
            )
            .orderBy(desc(favoritesTable.createdAt), desc(favoritesTable.id))
            .limit(limit)
            .offset(offset),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to get favorites: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'favorites',
          }),
      })

      return favorites.map(({ audioShowThumbnailUrl, ...favorite }) => ({
        ...favorite,
        audio: favorite.audio?.id
          ? {
              ...favorite.audio,
              thumbnailUrl: favorite.audio.thumbnailUrl ?? audioShowThumbnailUrl ?? null,
            }
          : null,
        show: favorite.show?.id ? favorite.show : null,
      }))
    }),
  )

const hasAudioFavoriteEffect = Effect.fn('favorite.hasAudio')(function* (
  userId: string,
  audioId: string,
) {
  const db = yield* Database

  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ id: favoritesTable.id })
        .from(favoritesTable)
        .innerJoin(audioTable, eq(favoritesTable.audioId, audioTable.id))
        .where(
          and(
            eq(favoritesTable.userId, userId),
            eq(favoritesTable.audioId, audioId),
            eq(audioTable.draft, false),
          ),
        )
        .limit(1),
    catch: () =>
      new DatabaseError({
        message: 'Failed to read audio favorite membership',
        operation: 'select',
        table: 'favorites',
      }),
  })

  return rows.length > 0
})

const getMembershipStateEffect = Effect.fn('favorite.membershipState')(function* (
  userId: string,
  targetKind: typeof MembershipTargetKind.Type,
  targetId: string,
) {
  const db = yield* Database
  const target = targetKind === 'audio' ? audioTable : showsTable

  const membership =
    targetKind === 'audio'
      ? sql`${favoritesTable.audioId} = ${target.id} AND ${favoritesTable.showId} IS NULL`
      : sql`${favoritesTable.showId} = ${target.id} AND ${favoritesTable.audioId} IS NULL`

  const subscribed =
    targetKind === 'show'
      ? sql`EXISTS (SELECT 1 FROM ${showSubscriptionsTable}
        WHERE ${showSubscriptionsTable.userId} = ${userId} AND ${showSubscriptionsTable.showId} = ${target.id})`
      : sql`NULL`

  const rows = yield* Effect.tryPromise({
    try: () =>
      db.all(sql`
      SELECT COALESCE((SELECT ${listenerMembershipRevisions.revision} FROM ${listenerMembershipRevisions}
        WHERE ${listenerMembershipRevisions.userId} = ${userId}), 0) AS revision,
      EXISTS (SELECT 1 FROM ${favoritesTable} WHERE ${favoritesTable.userId} = ${userId} AND ${membership}) AS favorited,
      ${subscribed} AS subscribed FROM ${target}
      WHERE ${target.id} = ${targetId} AND ${target.draft} = 0
        AND EXISTS (SELECT 1 FROM ${user} WHERE ${user.id} = ${userId} AND ${user.banned} = 0) LIMIT 1`),
    catch: () =>
      new DatabaseError({
        message: 'Failed to read membership state',
        operation: 'select',
        table: 'favorites',
      }),
  })

  const row = rows[0]

  if (!row) return yield* new NotFoundError({ message: 'Target not found', resource: 'membership' })

  return yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      revision: MembershipRevision,
      favorited: Schema.BooleanFromBit,
      subscribed: Schema.NullOr(Schema.BooleanFromBit),
    }),
  )(row).pipe(
    Effect.mapError(
      () =>
        new DatabaseError({
          message: 'Invalid membership state',
          operation: 'select',
          table: 'favorites',
        }),
    ),
  )
})

export const FavoriteServiceLayer = Layer.effect(
  FavoriteService,
  Effect.gen(function* () {
    const db = yield* Database
    const provideDb = Effect.provideService(Database, db)

    const write = (
      context: MembershipWriteContext,
      targetKind: 'audio' | 'show',
      targetId: string,
      desiredState: boolean,
    ) =>
      Effect.gen(function* () {
        const store = yield* McpOperationStore

        return yield* Effect.promise(() =>
          executeMembership(db, store, context, 'favorite', {
            requestId: context.requestId,
            expectedRevision: context.expectedRevision,
            targetKind,
            targetId,
            desiredState,
          }),
        )
      })

    return {
      getMembershipPage: (userId, kind, limit, offset) =>
        provideDb(getMembershipPageEffect(userId, kind, limit, offset)),
      getMembershipState: (userId, targetKind, targetId) =>
        provideDb(getMembershipStateEffect(userId, targetKind, targetId)),
      hasAudioFavorite: (userId, audioId) => provideDb(hasAudioFavoriteEffect(userId, audioId)),
      addFavorite: (context, audioId) => write(context, 'audio', audioId, true),
      addShowFavorite: (context, showId) => write(context, 'show', showId, true),
      removeFavorite: (context, audioId) => write(context, 'audio', audioId, false),
      removeShowFavorite: (context, showId) => write(context, 'show', showId, false),
      getFavorites: (userId, limit, offset) => provideDb(getFavoritesEffect(userId, limit, offset)),
    }
  }),
)
