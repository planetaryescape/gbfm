import { and, count, desc, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { user as usersTable } from '@/db/auth.schema'
import { favoritesTable } from '@/db/favorites.schema'
import { projectEntityLabelsForRows } from '@/db/labels'
import { Database } from '@/db/layer'
import {
  type SelectShow,
  type SelectShowSubscription,
  showSubscriptionsTable,
  showsTable,
} from '@/db/show.schema'
import { ConflictError, DatabaseError, getErrorMessage, NotFoundError } from '@/errors'
import { createPaginationMetadata, type PaginationMetadata } from '@/lib/pagination'
import { recordShowSubscribe, recordShowUnsubscribe } from '@/lib/performance-monitoring'

type SubscriptionWithShow = SelectShowSubscription & {
  show: SelectShow
}

export interface ShowSubscriptionService {
  readonly subscribe: (
    userId: string,
    showId: string,
  ) => Effect.Effect<SelectShowSubscription, DatabaseError | ConflictError>
  readonly unsubscribe: (
    userId: string,
    showId: string,
  ) => Effect.Effect<void, DatabaseError | NotFoundError>
  readonly getUserSubscriptions: (
    userId: string,
    options: { limit: number; offset: number },
  ) => Effect.Effect<
    { data: Array<SubscriptionWithShow>; pagination: PaginationMetadata },
    DatabaseError
  >
  readonly isSubscribed: (userId: string, showId: string) => Effect.Effect<boolean, DatabaseError>
  readonly getSubscribers: (
    showId: string,
  ) => Effect.Effect<Array<{ userId: string; email: string; name: string }>, DatabaseError>
}

export const ShowSubscriptionService =
  Context.Service<ShowSubscriptionService>('ShowSubscriptionService')

const subscribeEffect = (userId: string, showId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const showRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: showsTable.id })
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

    if (!showRecords[0]) {
      return yield* new ConflictError({
        message: 'Show not found',
        resource: 'show_subscription',
      })
    }

    const result = yield* Effect.tryPromise({
      try: () => db.insert(showSubscriptionsTable).values({ userId, showId }).returning(),
      catch: (error) => {
        const errorMessage = getErrorMessage(error)

        if (errorMessage.includes('unique constraint')) {
          return new ConflictError({
            message: 'Already subscribed to this show',
            resource: 'show_subscription',
          })
        }

        if (errorMessage.includes('foreign key constraint')) {
          return new ConflictError({
            message: 'Show not found',
            resource: 'show_subscription',
          })
        }

        return new DatabaseError({
          message: `Failed to subscribe: ${errorMessage}`,
          operation: 'insert',
          table: 'show_subscriptions',
        })
      },
    })

    const subscription = result[0]

    if (!subscription) {
      return yield* new DatabaseError({
        message: 'Failed to create subscription',
        operation: 'insert',
        table: 'show_subscriptions',
      })
    }

    yield* recordShowSubscribe

    yield* Effect.tryPromise(() =>
      db.insert(favoritesTable).values({ userId, showId }).onConflictDoNothing(),
    ).pipe(Effect.catch(() => Effect.void))

    return subscription
  })

const unsubscribeEffect = (userId: string, showId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const result = yield* Effect.tryPromise({
      try: () =>
        db
          .delete(showSubscriptionsTable)
          .where(
            and(
              eq(showSubscriptionsTable.userId, userId),
              eq(showSubscriptionsTable.showId, showId),
            ),
          )
          .returning(),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to unsubscribe: ${getErrorMessage(error)}`,
          operation: 'delete',
          table: 'show_subscriptions',
        }),
    })

    if (result.length === 0) {
      return yield* new NotFoundError({
        message: 'Subscription not found',
        resource: 'show_subscription',
      })
    }

    yield* recordShowUnsubscribe

    return undefined
  })

const getUserSubscriptionsEffect = (userId: string, options: { limit: number; offset: number }) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { limit, offset } = options

    const whereCondition = and(
      eq(showSubscriptionsTable.userId, userId),
      eq(showsTable.draft, false),
    )

    const countResult = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ total: count() })
          .from(showSubscriptionsTable)
          .innerJoin(showsTable, eq(showSubscriptionsTable.showId, showsTable.id))
          .where(whereCondition),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to count subscriptions: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'show_subscriptions',
        }),
    })

    const total = countResult[0]?.total ?? 0

    const subscriptions = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            id: showSubscriptionsTable.id,
            userId: showSubscriptionsTable.userId,
            showId: showSubscriptionsTable.showId,
            createdAt: showSubscriptionsTable.createdAt,
            show: showsTable,
          })
          .from(showSubscriptionsTable)
          .innerJoin(showsTable, eq(showSubscriptionsTable.showId, showsTable.id))
          .where(whereCondition)
          .limit(limit)
          .offset(offset)
          .orderBy(desc(showSubscriptionsTable.createdAt), desc(showSubscriptionsTable.id)),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch subscriptions: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'show_subscriptions',
        }),
    })

    const shows = yield* Effect.tryPromise({
      try: () =>
        projectEntityLabelsForRows(
          db,
          'show',
          subscriptions.map((subscription) => subscription.show),
        ),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })

    return {
      data: subscriptions.map((subscription, index) => ({
        ...subscription,
        show: shows[index] ?? { ...subscription.show, tags: [] },
      })),
      pagination: createPaginationMetadata(total, limit, offset),
    }
  })

const isSubscribedEffect = (userId: string, showId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const subscriptions = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: showSubscriptionsTable.id })
          .from(showSubscriptionsTable)
          .innerJoin(showsTable, eq(showSubscriptionsTable.showId, showsTable.id))
          .where(
            and(
              eq(showSubscriptionsTable.userId, userId),
              eq(showSubscriptionsTable.showId, showId),
              eq(showsTable.draft, false),
            ),
          )
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to check subscription: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'show_subscriptions',
        }),
    })

    return subscriptions.length > 0
  })

const getSubscribersEffect = (showId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const subscribers = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            userId: usersTable.id,
            email: usersTable.email,
            name: usersTable.name,
          })
          .from(showSubscriptionsTable)
          .innerJoin(usersTable, eq(showSubscriptionsTable.userId, usersTable.id))
          .where(eq(showSubscriptionsTable.showId, showId)),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch subscribers: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'show_subscriptions',
        }),
    })

    return subscribers
  })

export const ShowSubscriptionServiceLayer = Layer.effect(
  ShowSubscriptionService,
  Effect.gen(function* () {
    const db = yield* Database
    const provideDb = Effect.provideService(Database, db)

    return {
      subscribe: (userId, showId) =>
        provideDb(subscribeEffect(userId, showId)).pipe(
          Effect.withSpan('showSubscription.subscribe', {
            attributes: { showId },
          }),
        ),
      unsubscribe: (userId, showId) =>
        provideDb(unsubscribeEffect(userId, showId)).pipe(
          Effect.withSpan('showSubscription.unsubscribe', {
            attributes: { showId },
          }),
        ),
      getUserSubscriptions: (userId, options) =>
        provideDb(getUserSubscriptionsEffect(userId, options)).pipe(
          Effect.withSpan('showSubscription.getUserSubscriptions'),
        ),
      isSubscribed: (userId, showId) =>
        provideDb(isSubscribedEffect(userId, showId)).pipe(
          Effect.withSpan('showSubscription.isSubscribed'),
        ),
      getSubscribers: (showId) =>
        provideDb(getSubscribersEffect(showId)).pipe(
          Effect.withSpan('showSubscription.getSubscribers', {
            attributes: { showId },
          }),
        ),
    }
  }),
)
