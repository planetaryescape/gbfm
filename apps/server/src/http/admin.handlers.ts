import { SimulatedRateLimitError } from '@gbfm/api/admin'
import { Api } from '@gbfm/api/api'
import { AuthSession } from '@gbfm/api/middleware/auth'
import {
  EMAIL_DELIVERY_STATUSES,
  REMINDER_STATUS,
  type EmailDeliveryStatus,
} from '@gbfm/core/status'
import { and, desc, eq, gt, gte, inArray, lte, or, type SQL, sql } from 'drizzle-orm'
import { Effect, Match } from 'effect'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import { audioCreators, audioTable } from '@/db/audio.schema'
import { session, user } from '@/db/auth.schema'
import { emailDeliveryLogsTable } from '@/db/email.schema'
import { favoritesTable } from '@/db/favorites.schema'
import { Database } from '@/db/layer'
import { musicLabelsTable } from '@/db/music-entity.schema'
import { musicReminder } from '@/db/music-reminder.schema'
import { newsletterSubscribersTable } from '@/db/newsletter.schema'
import { postsTable } from '@/db/post.schema'
import { releasesTable } from '@/db/release.schema'
import { showSubscriptionsTable, showsTable } from '@/db/show.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
import { dieOnDatabaseError } from '@/http/handler-utils'
import { AdminTelemetryService } from '@/services/admin-telemetry.service'
import { loadFeaturedMix, saveFeaturedMix } from '@/services/featured-mix'

const dieOnAdminDatabaseError = dieOnDatabaseError('admin')

type ContentTable = typeof audioTable | typeof showsTable | typeof postsTable | typeof releasesTable

type DraftColumn =
  | typeof audioTable.draft
  | typeof showsTable.draft
  | typeof postsTable.draft
  | typeof releasesTable.draft

type CreatedAtColumn =
  | typeof audioTable.createdAt
  | typeof showsTable.createdAt
  | typeof postsTable.createdAt
  | typeof releasesTable.createdAt

type RecentContentItem = {
  id: string
  title: string | null
  slug: string
  type: 'mix' | 'track' | 'misc' | 'show' | 'post' | 'micro' | 'label' | 'release'
  createdAt: string
  draft: boolean
}

function isEmailStatusCountKey(
  value: string,
  counts: Record<EmailDeliveryStatus, number>,
): value is keyof typeof counts {
  return value in counts
}

function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)

  return date
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : new Date(0).toISOString()
}

async function getContentBreakdown(
  db: Database['Service'],
  table: ContentTable,
  draftColumn: DraftColumn,
  createdAtColumn: CreatedAtColumn,
  extraCondition?: SQL,
) {
  const sevenDaysAgo = daysAgo(7)

  const [published, drafts, newLast7Days] = await Promise.all([
    db.$count(
      table,
      extraCondition ? and(eq(draftColumn, false), extraCondition) : eq(draftColumn, false),
    ),
    db.$count(
      table,
      extraCondition ? and(eq(draftColumn, true), extraCondition) : eq(draftColumn, true),
    ),
    db.$count(
      table,
      extraCondition
        ? and(gte(createdAtColumn, sevenDaysAgo), extraCondition)
        : gte(createdAtColumn, sevenDaysAgo),
    ),
  ])

  return { published, drafts, newLast7Days }
}

async function getMusicLabelBreakdown(db: Database['Service']) {
  const sevenDaysAgo = daysAgo(7)
  const now = new Date()

  const [published, drafts, newLast7Days] = await Promise.all([
    db.$count(musicLabelsTable, lte(musicLabelsTable.publishedAt, now)),
    db.$count(
      musicLabelsTable,
      or(sql`${musicLabelsTable.publishedAt} is null`, gt(musicLabelsTable.publishedAt, now)),
    ),
    db.$count(musicLabelsTable, gte(musicLabelsTable.createdAt, sevenDaysAgo)),
  ])

  return { published, drafts, newLast7Days }
}

// Single try/catch around the whole aggregation batch, matching the old
// Hono handler's one try/catch around its Promise.all -- this endpoint is a
// dashboard read, not a transactional write, so a partial-failure/retry
// story per-query would be new behavior, not a faithful port.
async function loadAdminOverview(db: Database['Service']) {
  const now = new Date()
  const sevenDaysAgo = daysAgo(7)
  const thirtyDaysAgo = daysAgo(30)

  const [
    totalUsers,
    verifiedUsers,
    admins,
    editors,
    creators,
    bannedUsers,
    newUsersLast7Days,
    newUsersLast30Days,
    activeSessions,
    newsletterSubscribers,
    newSubscribersLast7Days,
    newSubscribersLast30Days,
    favoritesTotal,
    showSubscriptionsTotal,
    mixes,
    tracks,
    miscAudio,
    shows,
    posts,
    micros,
    labels,
    releases,
    totalPlayCountRows,
    newMixesLast30Days,
    recentAudio,
    recentShows,
    recentPosts,
    recentLabels,
    recentReleases,
    topMixRows,
    recentUsersRows,
    recentSubscriberRows,
    emailStatusRows,
    failedLast7Days,
    recentEmailFailures,
    reminderRows,
  ] = await Promise.all([
    db.$count(user),
    db.$count(user, eq(user.emailVerified, true)),
    db.$count(user, eq(user.role, 'admin')),
    db.$count(user, eq(user.role, 'editor')),
    db.$count(user, eq(user.role, 'creator')),
    db.$count(user, eq(user.banned, true)),
    db.$count(user, gte(user.createdAt, sevenDaysAgo)),
    db.$count(user, gte(user.createdAt, thirtyDaysAgo)),
    db.$count(session, gt(session.expiresAt, now)),
    db.$count(newsletterSubscribersTable),
    db.$count(newsletterSubscribersTable, gte(newsletterSubscribersTable.createdAt, sevenDaysAgo)),
    db.$count(newsletterSubscribersTable, gte(newsletterSubscribersTable.createdAt, thirtyDaysAgo)),
    db.$count(favoritesTable),
    db.$count(showSubscriptionsTable),
    getContentBreakdown(
      db,
      audioTable,
      audioTable.draft,
      audioTable.createdAt,
      eq(audioTable.type, 'mix'),
    ),
    getContentBreakdown(
      db,
      audioTable,
      audioTable.draft,
      audioTable.createdAt,
      eq(audioTable.type, 'track'),
    ),
    getContentBreakdown(
      db,
      audioTable,
      audioTable.draft,
      audioTable.createdAt,
      eq(audioTable.type, 'misc'),
    ),
    getContentBreakdown(db, showsTable, showsTable.draft, showsTable.createdAt),
    getContentBreakdown(
      db,
      postsTable,
      postsTable.draft,
      postsTable.createdAt,
      eq(postsTable.type, 'post'),
    ),
    getContentBreakdown(
      db,
      postsTable,
      postsTable.draft,
      postsTable.createdAt,
      eq(postsTable.type, 'micro'),
    ),
    getMusicLabelBreakdown(db),
    getContentBreakdown(db, releasesTable, releasesTable.draft, releasesTable.createdAt),
    db
      .select({ total: sql<number>`coalesce(sum(${audioTable.playCount}), 0)`.mapWith(Number) })
      .from(audioTable),
    db.$count(
      audioTable,
      and(eq(audioTable.type, 'mix'), gte(audioTable.createdAt, thirtyDaysAgo)),
    ),
    db
      .select({
        id: audioTable.id,
        title: audioTable.title,
        slug: audioTable.slug,
        type: audioTable.type,
        createdAt: audioTable.createdAt,
        draft: audioTable.draft,
      })
      .from(audioTable)
      .orderBy(desc(audioTable.createdAt))
      .limit(6),
    db
      .select({
        id: showsTable.id,
        title: showsTable.title,
        slug: showsTable.slug,
        createdAt: showsTable.createdAt,
        draft: showsTable.draft,
      })
      .from(showsTable)
      .orderBy(desc(showsTable.createdAt))
      .limit(4),
    db
      .select({
        id: postsTable.id,
        title: postsTable.title,
        slug: postsTable.slug,
        type: postsTable.type,
        createdAt: postsTable.createdAt,
        draft: postsTable.draft,
      })
      .from(postsTable)
      .orderBy(desc(postsTable.createdAt))
      .limit(6),
    db
      .select({
        id: musicLabelsTable.id,
        title: musicLabelsTable.name,
        slug: musicLabelsTable.slug,
        createdAt: musicLabelsTable.createdAt,
        draft:
          sql<number>`${musicLabelsTable.publishedAt} is null or ${gt(musicLabelsTable.publishedAt, now)}`.mapWith(
            Boolean,
          ),
      })
      .from(musicLabelsTable)
      .orderBy(desc(musicLabelsTable.createdAt))
      .limit(4),
    db
      .select({
        id: releasesTable.id,
        title: releasesTable.title,
        slug: releasesTable.slug,
        createdAt: releasesTable.createdAt,
        draft: releasesTable.draft,
      })
      .from(releasesTable)
      .orderBy(desc(releasesTable.createdAt))
      .limit(4),
    db
      .select({
        id: audioTable.id,
        title: audioTable.title,
        slug: audioTable.slug,
        playCount: audioTable.playCount,
        createdAt: audioTable.createdAt,
      })
      .from(audioTable)
      .where(eq(audioTable.type, 'mix'))
      .orderBy(desc(audioTable.playCount), desc(audioTable.createdAt))
      .limit(5),
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified,
      })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(5),
    db
      .select({
        id: newsletterSubscribersTable.id,
        email: newsletterSubscribersTable.email,
        source: newsletterSubscribersTable.source,
        createdAt: newsletterSubscribersTable.createdAt,
      })
      .from(newsletterSubscribersTable)
      .orderBy(desc(newsletterSubscribersTable.createdAt))
      .limit(5),
    db
      .select({
        status: emailDeliveryLogsTable.status,
        total: sql<number>`count(*)`.mapWith(Number),
      })
      .from(emailDeliveryLogsTable)
      .groupBy(emailDeliveryLogsTable.status),
    db.$count(
      emailDeliveryLogsTable,
      and(
        eq(emailDeliveryLogsTable.status, EMAIL_DELIVERY_STATUSES.FAILED),
        gte(emailDeliveryLogsTable.createdAt, sevenDaysAgo),
      ),
    ),
    db
      .select({
        id: emailDeliveryLogsTable.id,
        recipientEmail: emailDeliveryLogsTable.recipientEmail,
        subject: emailDeliveryLogsTable.subject,
        status: emailDeliveryLogsTable.status,
        createdAt: emailDeliveryLogsTable.createdAt,
        errorMessage: emailDeliveryLogsTable.errorMessage,
      })
      .from(emailDeliveryLogsTable)
      .where(
        inArray(emailDeliveryLogsTable.status, [
          EMAIL_DELIVERY_STATUSES.FAILED,
          EMAIL_DELIVERY_STATUSES.BOUNCED,
          EMAIL_DELIVERY_STATUSES.COMPLAINED,
        ]),
      )
      .orderBy(desc(emailDeliveryLogsTable.createdAt))
      .limit(5),
    db
      .select({
        pending: db.$count(
          musicReminder,
          and(
            inArray(musicReminder.dispatchState, ['open', 'fenced']),
            eq(musicReminder.status, REMINDER_STATUS.PENDING),
          ),
        ),
        processing: db.$count(
          musicReminder,
          and(
            inArray(musicReminder.dispatchState, ['open', 'fenced']),
            eq(musicReminder.status, REMINDER_STATUS.PROCESSING),
          ),
        ),
        failed: db.$count(
          musicReminder,
          and(
            inArray(musicReminder.dispatchState, ['open', 'fenced']),
            eq(musicReminder.status, REMINDER_STATUS.FAILED),
          ),
        ),
        dueNow: db.$count(
          musicReminder,
          and(
            inArray(musicReminder.dispatchState, ['open', 'fenced']),
            lte(musicReminder.reminderDate, now),
            or(
              eq(musicReminder.status, REMINDER_STATUS.PENDING),
              eq(musicReminder.status, REMINDER_STATUS.FAILED),
            ),
          ),
        ),
      })
      .from(musicReminder),
  ])

  const recentContent: Array<RecentContentItem> = [
    ...recentAudio.map<RecentContentItem>((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      type: Match.value(item.type).pipe(
        Match.when('mix', () => 'mix' as const),
        Match.when('track', () => 'track' as const),
        Match.orElse(() => 'misc' as const),
      ),
      createdAt: iso(item.createdAt),
      draft: item.draft,
    })),
    ...recentShows.map<RecentContentItem>((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      type: 'show',
      createdAt: iso(item.createdAt),
      draft: item.draft,
    })),
    ...recentPosts.map<RecentContentItem>((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      type: item.type === 'micro' ? 'micro' : 'post',
      createdAt: iso(item.createdAt),
      draft: item.draft,
    })),
    ...recentLabels.map<RecentContentItem>((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      type: 'label',
      createdAt: iso(item.createdAt),
      draft: item.draft,
    })),
    ...recentReleases.map<RecentContentItem>((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      type: 'release',
      createdAt: iso(item.createdAt),
      draft: item.draft,
    })),
  ]
    .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)

  const topMixIds = topMixRows.map((mix) => mix.id)

  const topMixCreatorRows =
    topMixIds.length === 0
      ? []
      : await db
          .select({ audioId: audioCreators.audioId, creatorName: user.name })
          .from(audioCreators)
          .innerJoin(user, eq(audioCreators.creatorId, user.id))
          .where(inArray(audioCreators.audioId, topMixIds))

  const creatorsByMixId = new Map<string, Array<string>>()

  for (const row of topMixCreatorRows) {
    const names = creatorsByMixId.get(row.audioId) ?? []
    names.push(row.creatorName)
    creatorsByMixId.set(row.audioId, names)
  }

  const emailCounts = {
    PENDING: 0,
    SENT: 0,
    DELIVERED: 0,
    BOUNCED: 0,
    COMPLAINED: 0,
    FAILED: 0,
  }

  for (const row of emailStatusRows) {
    if (isEmailStatusCountKey(row.status, emailCounts)) {
      emailCounts[row.status] = row.total
    }
  }

  return {
    generatedAt: now.toISOString(),
    highlights: {
      totalUsers,
      verifiedUsers,
      newsletterSubscribers,
      totalPlayCount: totalPlayCountRows[0]?.total ?? 0,
      publishedMixes: mixes.published,
      newUsersLast7Days,
      newSubscribersLast30Days,
      newMixesLast30Days,
    },
    publishing: {
      mixes,
      tracks,
      miscAudio,
      shows,
      posts,
      micros,
      labels,
      releases,
      recentContent,
      topMixes: topMixRows.map((mix) => ({
        id: mix.id,
        title: mix.title,
        slug: mix.slug,
        playCount: mix.playCount,
        createdAt: iso(mix.createdAt),
        creators: creatorsByMixId.get(mix.id) ?? [],
      })),
    },
    community: {
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        admins,
        editors,
        creators,
        banned: bannedUsers,
        newLast7Days: newUsersLast7Days,
        newLast30Days: newUsersLast30Days,
      },
      sessions: { active: activeSessions },
      newsletter: {
        total: newsletterSubscribers,
        newLast7Days: newSubscribersLast7Days,
        newLast30Days: newSubscribersLast30Days,
      },
      engagement: { favoritesTotal, showSubscriptionsTotal },
      recentUsers: recentUsersRows.map((item) => ({ ...item, createdAt: iso(item.createdAt) })),
      recentSubscribers: recentSubscriberRows.map((item) => ({
        ...item,
        source: item.source ?? null,
        createdAt: iso(item.createdAt),
      })),
    },
    operations: {
      emails: {
        total: emailStatusRows.reduce((sum, row) => sum + row.total, 0),
        sent: emailCounts.SENT,
        delivered: emailCounts.DELIVERED,
        bounced: emailCounts.BOUNCED,
        complained: emailCounts.COMPLAINED,
        failed: emailCounts.FAILED,
        pending: emailCounts.PENDING,
        failedLast7Days,
        recentFailures: recentEmailFailures.map((item) => ({
          ...item,
          createdAt: iso(item.createdAt),
          errorMessage: item.errorMessage ?? null,
        })),
      },
      reminders: {
        pending: reminderRows[0]?.pending ?? 0,
        processing: reminderRows[0]?.processing ?? 0,
        failed: reminderRows[0]?.failed ?? 0,
        dueNow: reminderRows[0]?.dueNow ?? 0,
      },
    },
  }
}

const requireAdmin = Effect.gen(function* () {
  const { user: sessionUser } = yield* AuthSession

  if (sessionUser.role !== 'admin') {
    return yield* new HttpApiError.Forbidden()
  }

  return undefined
})

export const AdminHandlersLive = HttpApiBuilder.group(Api, 'admin', (handlers) =>
  handlers
    .handle('getFeaturedMixSettings', () =>
      Effect.gen(function* () {
        yield* requireAdmin

        return yield* dieOnAdminDatabaseError(loadFeaturedMix())
      }),
    )
    .handle('setFeaturedMix', ({ payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        yield* dieOnAdminDatabaseError(saveFeaturedMix(payload.mixId)).pipe(
          Effect.catchTag('ValidationError', () => new HttpApiError.BadRequest()),
        )

        return payload
      }),
    )
    .handle('getAdminOverview', () =>
      Effect.gen(function* () {
        yield* requireAdmin
        const db = yield* Database

        return yield* dieOnAdminDatabaseError(
          Effect.tryPromise({
            try: () => loadAdminOverview(db),
            catch: (error) =>
              new DatabaseError({
                message: `Failed to fetch admin overview: ${getErrorMessage(error)}`,
                operation: 'select',
                table: 'admin-overview',
              }),
          }),
        )
      }),
    )
    .handle('getAdminTelemetry', () =>
      Effect.gen(function* () {
        yield* requireAdmin
        const telemetry = yield* AdminTelemetryService

        return yield* telemetry.dashboard
      }),
    )
    .handle('simulateFrontendError', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin

        switch (params.scenario) {
          case 'ok':
            return {
              scenario: params.scenario,
              message: 'Frontend error simulator is reachable.',
            }
          case 'bad-request':
            return yield* new HttpApiError.BadRequest()
          case 'not-found':
            return yield* new HttpApiError.NotFound()
          case 'rate-limit':
            return yield* new SimulatedRateLimitError()
          case 'error':
            return yield* new HttpApiError.InternalServerError()
          case 'unavailable':
            return yield* new HttpApiError.ServiceUnavailable()
        }

        return yield* new HttpApiError.InternalServerError()
      }),
    )
    .handle('getNewsletterSubscribers', () =>
      Effect.gen(function* () {
        yield* requireAdmin
        const db = yield* Database

        const rows = yield* dieOnAdminDatabaseError(
          Effect.tryPromise({
            try: () =>
              db
                .select({
                  id: newsletterSubscribersTable.id,
                  email: newsletterSubscribersTable.email,
                  name: newsletterSubscribersTable.name,
                  source: newsletterSubscribersTable.source,
                  unsubscribedAt: newsletterSubscribersTable.unsubscribedAt,
                  createdAt: newsletterSubscribersTable.createdAt,
                })
                .from(newsletterSubscribersTable)
                .orderBy(desc(newsletterSubscribersTable.createdAt)),
            catch: (error) =>
              new DatabaseError({
                message: `Failed to fetch newsletter subscribers: ${getErrorMessage(error)}`,
                operation: 'select',
                table: 'newsletter_subscribers',
              }),
          }),
        )

        return {
          subscribers: rows.map((r) => ({
            ...r,
            unsubscribedAt: r.unsubscribedAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
          })),
        }
      }),
    ),
)
