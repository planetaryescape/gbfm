import { Api } from '@gbfm/api/api'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { ValidationHttpError } from '@gbfm/api/post'
import { Effect } from 'effect'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import {
  dieOnDatabaseError as makeDieOnDatabaseError,
  getOptionalActor,
} from '@/http/handler-utils'
import { omitUndefined } from '@/lib/omit-undefined'
import { makeSessionCommandAuthority } from '@/mcp/command-authority'
import { membershipOutcome, membershipWriteContext } from '@/mcp/favorites/command'
import { membershipHttpError } from '@/mcp/favorites/http'
import { QRCodeService } from '@/services/qrcode.service'
import { loadShowPage } from '@/services/show-page'
import { ShowService, ShowSubscriptionService } from '@/services/show.service'

import { resolvePageSession } from './page-session'

const dieOnDatabaseError = makeDieOnDatabaseError('shows')

export const ShowsHandlersLive = HttpApiBuilder.group(Api, 'shows', (handlers) =>
  handlers
    .handle('getShowPage', ({ params }) =>
      Effect.gen(function* () {
        const principal = yield* resolvePageSession()

        return yield* loadShowPage(params.slug, principal)
      }),
    )
    .handle('getAllShows', ({ query }) =>
      Effect.gen(function* () {
        const svc = yield* ShowService

        const result = yield* dieOnDatabaseError(
          svc.getAll({
            limit: query.limit ?? 20,
            offset: query.offset ?? 0,
          }),
        )

        return {
          data: result.data.map((show) => ({
            ...show,
            createdAt: show.createdAt.toISOString(),
            updatedAt: show.updatedAt.toISOString(),
          })),
          pagination: result.pagination,
        }
      }),
    )
    .handle('getShowsForEdit', ({ query }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* ShowService

        const result = yield* dieOnDatabaseError(
          svc.getAllForEdit(
            { limit: query.limit ?? 20, offset: query.offset ?? 0 },
            user.id,
            user.role ?? 'user',
          ),
        )

        return {
          data: result.data.map((show) => ({
            ...show,
            createdAt: show.createdAt.toISOString(),
            updatedAt: show.updatedAt.toISOString(),
          })),
          pagination: result.pagination,
        }
      }),
    )
    .handle('getShowBySlug', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* ShowService

        const show = yield* dieOnDatabaseError(
          svc
            .getBySlug(params.slug)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return {
          ...show,
          createdAt: show.createdAt.toISOString(),
          updatedAt: show.updatedAt.toISOString(),
        }
      }),
    )
    .handle('getShowBySlugForEdit', ({ params }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* ShowService

        const show = yield* dieOnDatabaseError(
          svc.getBySlugForEdit(params.slug, user.id, user.role ?? 'user').pipe(
            Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
            Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
          ),
        )

        return {
          ...show,
          createdAt: show.createdAt.toISOString(),
          updatedAt: show.updatedAt.toISOString(),
        }
      }),
    )
    .handle('createShow', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const { hostIds, tags, ...showData } = payload
        const finalHostIds = hostIds?.length ? [...hostIds] : [user.id]

        const svc = yield* ShowService

        const show = yield* dieOnDatabaseError(
          svc
            .create(
              omitUndefined({ ...showData, tags: tags ? [...tags] : undefined }),
              finalHostIds,
              { userId: user.id, userRole: user.role ?? 'user', credential: undefined },
            )
            .pipe(
              Effect.catchTag('ConflictError', () => new HttpApiError.Conflict()),
              Effect.catchTag('S3Error', () => new HttpApiError.InternalServerError()),
              Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
              Effect.catchTag('ValidationError', () => new ValidationHttpError()),
            ),
        )

        return {
          ...show,
          createdAt: show.createdAt.toISOString(),
          updatedAt: show.updatedAt.toISOString(),
        }
      }),
    )
    .handle('updateShowBySlug', ({ params, payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const { hostIds, tags, ...updateData } = payload
        const svc = yield* ShowService

        const show = yield* dieOnDatabaseError(
          svc
            .update(
              params.slug,
              user.id,
              user.role ?? 'user',
              omitUndefined({
                ...updateData,
                ...(tags && { tags: [...tags] }),
                ...(hostIds && { hostIds: [...hostIds] }),
              }),
            )
            .pipe(
              Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
              Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
              Effect.catchTag('S3Error', () => new HttpApiError.InternalServerError()),
              Effect.catchTag('ValidationError', () => new ValidationHttpError()),
            ),
        )

        return {
          ...show,
          createdAt: show.createdAt.toISOString(),
          updatedAt: show.updatedAt.toISOString(),
        }
      }),
    )
    .handle('deleteShowBySlug', ({ params }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* ShowService
        yield* dieOnDatabaseError(
          svc.delete(params.slug, user.id, user.role ?? 'user').pipe(
            Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
            Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
          ),
        )
      }),
    )
    .handle('getShowEpisodes', ({ params, query }) =>
      Effect.gen(function* () {
        const actor = yield* getOptionalActor
        const svc = yield* ShowService

        const result = yield* dieOnDatabaseError(
          svc
            .getEpisodes(
              params.slug,
              { limit: query.limit ?? 20, offset: query.offset ?? 0 },
              actor,
            )
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return {
          data: result.data.map((episode) => ({
            ...episode,
            createdAt: episode.createdAt.toISOString(),
            updatedAt: episode.updatedAt.toISOString(),
          })),
          pagination: result.pagination,
        }
      }),
    )
    .handle('subscribeToShow', ({ params, payload }) =>
      Effect.gen(function* () {
        const svc = yield* ShowSubscriptionService
        const authority = yield* makeSessionCommandAuthority

        const context = yield* membershipWriteContext(
          authority,
          ['subscriptions:write', 'favorites:write'],
          payload,
        )

        return yield* membershipOutcome(yield* svc.subscribe(context, params.id))
      }).pipe(Effect.catchTag('McpToolError', membershipHttpError)),
    )
    .handle('unsubscribeFromShow', ({ params, payload }) =>
      Effect.gen(function* () {
        const svc = yield* ShowSubscriptionService
        const authority = yield* makeSessionCommandAuthority
        const context = yield* membershipWriteContext(authority, ['subscriptions:write'], payload)

        return yield* membershipOutcome(yield* svc.unsubscribe(context, params.id))
      }).pipe(Effect.catchTag('McpToolError', membershipHttpError)),
    )
    .handle('getShowSubscriptionStatus', ({ params }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* ShowSubscriptionService

        return {
          subscribed: yield* dieOnDatabaseError(svc.isSubscribed(user.id, params.id)),
        }
      }),
    )
    .handle('getShowQRPdf', ({ params }) =>
      Effect.gen(function* () {
        const showSvc = yield* ShowService
        const qrSvc = yield* QRCodeService

        const show = yield* dieOnDatabaseError(
          showSvc
            .getBySlug(params.slug)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return yield* dieOnDatabaseError(
          qrSvc.generateShowQRPdf(
            omitUndefined({
              slug: show.slug,
              title: show.title,
              thumbnailUrl: show.thumbnailUrl,
              hosts: show.hosts,
            }),
          ),
        )
      }),
    ),
)
