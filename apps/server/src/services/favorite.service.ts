import { and, desc, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { Context, Effect, Layer } from 'effect'

import { audioTable } from '@/db/audio.schema'
import { favoritesTable, type SelectFavorite } from '@/db/favorites.schema'
import { Database } from '@/db/layer'
import { showSubscriptionsTable, showsTable } from '@/db/show.schema'
import { ConflictError, DatabaseError, getErrorMessage, NotFoundError } from '@/errors'
import { recordFavoriteAdd, recordFavoriteRemove } from '@/lib/performance-monitoring'

const audioShowsTable = alias(showsTable, 'audio_shows')

type FavoriteWithContent = {
  id: string
  userId: string
  audioId: string | null
  showId: string | null
  createdAt: Date
  audio: {
    id: string
    title: string
    slug: string
    thumbnailUrl: string | null
    type: 'mix' | 'track' | 'misc'
    url: string
  } | null
  show: {
    id: string
    title: string
    slug: string
    thumbnailUrl: string | null
  } | null
}

// Service interface
export interface FavoriteService {
  readonly hasAudioFavorite: (
    userId: string,
    audioId: string,
  ) => Effect.Effect<boolean, DatabaseError>
  readonly addFavorite: (
    userId: string,
    audioId: string,
  ) => Effect.Effect<SelectFavorite, DatabaseError | NotFoundError | ConflictError>
  readonly addShowFavorite: (
    userId: string,
    showId: string,
  ) => Effect.Effect<SelectFavorite, DatabaseError | NotFoundError | ConflictError>
  readonly removeFavorite: (
    userId: string,
    audioId: string,
  ) => Effect.Effect<void, DatabaseError | NotFoundError>
  readonly removeShowFavorite: (
    userId: string,
    showId: string,
  ) => Effect.Effect<void, DatabaseError | NotFoundError>
  readonly getFavorites: (
    userId: string,
    limit?: number,
    offset?: number,
  ) => Effect.Effect<Array<FavoriteWithContent>, DatabaseError>
}

// Service tag for dependency injection
export const FavoriteService = Context.Service<FavoriteService>('FavoriteService')

// Core service logic - pure Effects with no service dependencies
const addFavoriteEffect = (userId: string, audioId: string) =>
  Effect.withSpan('favorite.add', {
    attributes: { audioId },
  })(
    Effect.gen(function* () {
      const db = yield* Database

      // Check if audio exists
      const audioRecords = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(audioTable)
            .where(and(eq(audioTable.id, audioId), eq(audioTable.draft, false)))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to check audio existence: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'audio',
          }),
      })

      if (audioRecords.length === 0) {
        return yield* new NotFoundError({
          message: 'Audio not found',
          resource: 'audio',
          id: audioId,
        })
      }

      // Guarded write: the unique_user_audio constraint, not a pre-read, is
      // what actually prevents a duplicate under concurrent requests. A
      // conflicting insert returns zero rows instead of throwing, so a
      // collision surfaces as the typed ConflictError below rather than an
      // unhandled DatabaseError defect.
      const insertedRecords = yield* Effect.tryPromise({
        try: () =>
          db
            .insert(favoritesTable)
            .values({
              userId,
              audioId,
            })
            .onConflictDoNothing({ target: [favoritesTable.userId, favoritesTable.audioId] })
            .returning(),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to add favorite: ${getErrorMessage(error)}`,
            operation: 'insert',
            table: 'favorites',
          }),
      })

      const favorite = insertedRecords[0]

      if (!favorite) {
        return yield* new ConflictError({
          message: 'Already favorited',
          resource: 'favorite',
          id: `${userId}-${audioId}`,
        })
      }

      yield* Effect.logInfo('[Favorites] Favorite added', {
        audioId,
        favoriteId: favorite.id,
      })

      yield* recordFavoriteAdd

      return favorite
    }),
  )

const removeFavoriteEffect = (userId: string, audioId: string) =>
  Effect.withSpan('favorite.remove', {
    attributes: { audioId },
  })(
    Effect.gen(function* () {
      const db = yield* Database

      // Check if favorite exists
      const existingRecords = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(favoritesTable)
            .where(and(eq(favoritesTable.userId, userId), eq(favoritesTable.audioId, audioId)))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to check favorite existence: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'favorites',
          }),
      })

      if (existingRecords.length === 0) {
        return yield* new NotFoundError({
          message: 'Favorite not found',
          resource: 'favorite',
          id: `${userId}-${audioId}`,
        })
      }

      // Remove favorite
      yield* Effect.tryPromise({
        try: () =>
          db
            .delete(favoritesTable)
            .where(and(eq(favoritesTable.userId, userId), eq(favoritesTable.audioId, audioId))),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to remove favorite: ${getErrorMessage(error)}`,
            operation: 'delete',
            table: 'favorites',
          }),
      })

      yield* recordFavoriteRemove

      yield* Effect.logInfo('[Favorites] Favorite removed', {
        audioId,
      })

      return undefined
    }),
  )

const addShowFavoriteEffect = (userId: string, showId: string) =>
  Effect.withSpan('favorite.addShow', {
    attributes: { showId },
  })(
    Effect.gen(function* () {
      const db = yield* Database

      const showRecords = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(showsTable)
            .where(and(eq(showsTable.id, showId), eq(showsTable.draft, false)))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to check show existence: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'shows',
          }),
      })

      if (showRecords.length === 0) {
        return yield* new NotFoundError({
          message: 'Show not found',
          resource: 'show',
          id: showId,
        })
      }

      const insertedRecords = yield* Effect.tryPromise({
        try: () =>
          db
            .insert(favoritesTable)
            .values({
              userId,
              showId,
            })
            .onConflictDoNothing({ target: [favoritesTable.userId, favoritesTable.showId] })
            .returning(),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to add favorite: ${getErrorMessage(error)}`,
            operation: 'insert',
            table: 'favorites',
          }),
      })

      const favorite = insertedRecords[0]

      if (!favorite) {
        return yield* new ConflictError({
          message: 'Already favorited',
          resource: 'favorite',
          id: `${userId}-${showId}`,
        })
      }

      // Auto-subscribe when favoriting a show. Guarded the same way: the
      // unique constraint decides, so a concurrent duplicate subscribe is a
      // silent no-op rather than a raced read-then-insert.
      const subscribed = yield* Effect.tryPromise({
        try: () =>
          db
            .insert(showSubscriptionsTable)
            .values({ userId, showId })
            .onConflictDoNothing({
              target: [showSubscriptionsTable.userId, showSubscriptionsTable.showId],
            })
            .returning(),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to subscribe: ${getErrorMessage(error)}`,
            operation: 'insert',
            table: 'show_subscriptions',
          }),
      })

      if (subscribed.length > 0) {
        yield* Effect.logInfo('[Favorites] Auto-subscribed to show', {
          showId,
        })
      }

      yield* recordFavoriteAdd
      yield* Effect.logInfo('[Favorites] Show favorite added', {
        favoriteId: favorite.id,
        showId,
      })

      return favorite
    }),
  )

const removeShowFavoriteEffect = (userId: string, showId: string) =>
  Effect.withSpan('favorite.removeShow', {
    attributes: { showId },
  })(
    Effect.gen(function* () {
      const db = yield* Database

      const existingRecords = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(favoritesTable)
            .where(and(eq(favoritesTable.userId, userId), eq(favoritesTable.showId, showId)))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to check existing favorite: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'favorites',
          }),
      })

      if (existingRecords.length === 0) {
        return yield* new NotFoundError({
          message: 'Favorite not found',
          resource: 'favorite',
          id: `${userId}-${showId}`,
        })
      }

      yield* Effect.tryPromise({
        try: () =>
          db
            .delete(favoritesTable)
            .where(and(eq(favoritesTable.userId, userId), eq(favoritesTable.showId, showId))),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to remove favorite: ${getErrorMessage(error)}`,
            operation: 'delete',
            table: 'favorites',
          }),
      })

      // Auto-unsubscribe when unfavoriting a show
      yield* Effect.tryPromise({
        try: () =>
          db
            .delete(showSubscriptionsTable)
            .where(
              and(
                eq(showSubscriptionsTable.userId, userId),
                eq(showSubscriptionsTable.showId, showId),
              ),
            ),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to unsubscribe: ${getErrorMessage(error)}`,
            operation: 'delete',
            table: 'show_subscriptions',
          }),
      })
      yield* Effect.logInfo('[Favorites] Auto-unsubscribed from show', {
        showId,
      })

      yield* recordFavoriteRemove
      yield* Effect.logInfo('[Favorites] Show favorite removed', {
        showId,
      })

      return undefined
    }),
  )

const getFavoritesEffect = (
  userId: string,
  limit = 20,
  offset = 0,
): Effect.Effect<Array<FavoriteWithContent>, DatabaseError, Database> =>
  Effect.withSpan('favorite.get', {
    attributes: { limit, offset },
  })(
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

      yield* Effect.logInfo('[Favorites] Favorites retrieved', {
        count: favorites.length,
        limit,
        offset,
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

// Implementation - simple layer that provides access to the Effects
export const FavoriteServiceLayer = Layer.effect(
  FavoriteService,
  Effect.gen(function* () {
    const db = yield* Database
    const provideDb = Effect.provideService(Database, db)

    return {
      hasAudioFavorite: (userId, audioId) => provideDb(hasAudioFavoriteEffect(userId, audioId)),
      addFavorite: (userId, audioId) => provideDb(addFavoriteEffect(userId, audioId)),
      addShowFavorite: (userId, showId) => provideDb(addShowFavoriteEffect(userId, showId)),
      removeFavorite: (userId, audioId) => provideDb(removeFavoriteEffect(userId, audioId)),
      removeShowFavorite: (userId, showId) => provideDb(removeShowFavoriteEffect(userId, showId)),
      getFavorites: (userId, limit, offset) => provideDb(getFavoritesEffect(userId, limit, offset)),
    }
  }),
)
