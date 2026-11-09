import { and, count, desc, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { user as usersTable } from '@/db/auth.schema'
import { projectEntityLabelsForRows } from '@/db/labels'
import { Database } from '@/db/layer'
import {
  type SelectShow,
  type SelectShowSubscription,
  showSubscriptionsTable,
  showsTable,
} from '@/db/show.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
import { createPaginationMetadata, type PaginationMetadata } from '@/lib/pagination'
import { executeMembership, type MembershipWriteContext } from '@/mcp/favorites/membership'
import { McpOperationStore, type OperationResult } from '@/mcp/operations/store'

type SubscriptionWithShow = SelectShowSubscription & {
  show: SelectShow
}

export interface ShowSubscriptionService {
  readonly subscribe: (
    context: MembershipWriteContext,
    showId: string,
  ) => Effect.Effect<OperationResult, never, McpOperationStore>
  readonly unsubscribe: (
    context: MembershipWriteContext,
    showId: string,
  ) => Effect.Effect<OperationResult, never, McpOperationStore>
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

    const write = (context: MembershipWriteContext, showId: string, desiredState: boolean) =>
      Effect.gen(function* () {
        const store = yield* McpOperationStore

        return yield* Effect.promise(() =>
          executeMembership(db, store, context, 'subscription', {
            requestId: context.requestId,
            expectedRevision: context.expectedRevision,
            targetKind: 'show',
            targetId: showId,
            desiredState,
          }),
        )
      })

    return {
      subscribe: (context, showId) =>
        write(context, showId, true).pipe(
          Effect.withSpan('showSubscription.subscribe', {
            attributes: { showId },
          }),
        ),
      unsubscribe: (context, showId) =>
        write(context, showId, false).pipe(
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
