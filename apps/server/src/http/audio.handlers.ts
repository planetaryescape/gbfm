import { Api } from '@gbfm/api/api'
import {
  GetAudioByTypeResponse,
  GetAudioTagsResponse,
  HomepageMixesResponse,
} from '@gbfm/api/audio'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { ValidationHttpError } from '@gbfm/api/post'
import { Effect, Schema } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import {
  dieOnDatabaseError as makeDieOnDatabaseError,
  getOptionalActor,
} from '@/http/handler-utils'
import { omitUndefined } from '@/lib/omit-undefined'
import { CommandAuthority, makeSessionCommandAuthority } from '@/mcp/command-authority'
import { loadAudioPage } from '@/services/audio-page'
import { AudioService } from '@/services/audio.service'
import { getHomepageMixes } from '@/services/featured-mix'
import { QRCodeService } from '@/services/qrcode.service'

import { resolvePageSession } from './page-session'

const dieOnDatabaseError = makeDieOnDatabaseError('audio')

const toDateStrings = <T extends { createdAt: Date; updatedAt: Date }>(audio: T) => ({
  ...audio,
  createdAt: audio.createdAt.toISOString(),
  updatedAt: audio.updatedAt.toISOString(),
})

export const AudioHandlersLive = HttpApiBuilder.group(Api, 'audio', (handlers) =>
  handlers
    .handle('getHomepageMixes', () =>
      Effect.gen(function* () {
        const result = yield* dieOnDatabaseError(getHomepageMixes())

        const encoded = yield* Schema.encodeEffect(HomepageMixesResponse)(result).pipe(Effect.orDie)

        // Preserve the public list endpoint's existing cache policy.
        return HttpServerResponse.setHeader(
          yield* HttpServerResponse.json(encoded).pipe(Effect.orDie),
          'Cache-Control',
          'public, max-age=60, stale-while-revalidate=300',
        )
      }),
    )
    .handle('createMix', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const { creatorIds, idempotencyKey, ...mixData } = payload
        const finalCreatorIds = creatorIds?.length ? [...creatorIds] : [user.id]

        const svc = yield* AudioService

        const audio = yield* dieOnDatabaseError(
          svc
            .create(
              omitUndefined({ ...mixData, tags: mixData.tags ? [...mixData.tags] : undefined }),
              finalCreatorIds,
              { actorId: user.id, actorRole: user.role ?? 'user', idempotencyKey },
            )
            .pipe(
              Effect.catchTag('ConflictError', () => new HttpApiError.Conflict()),
              Effect.catchTag('S3Error', () => new HttpApiError.InternalServerError()),
              Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
              Effect.catchTag('ValidationError', () => new ValidationHttpError()),
            ),
        )

        return toDateStrings(audio)
      }),
    )
    .handle('getAudioTags', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* AudioService
        const tags = yield* dieOnDatabaseError(svc.getTags(params.type))
        const body = yield* Schema.encodeEffect(GetAudioTagsResponse)(tags).pipe(Effect.orDie)

        return HttpServerResponse.setHeader(
          yield* HttpServerResponse.json(body).pipe(Effect.orDie),
          'Cache-Control',
          'public, max-age=3600, stale-while-revalidate=86400',
        )
      }),
    )
    .handle('getAudioByType', ({ params, query }) =>
      Effect.gen(function* () {
        const svc = yield* AudioService

        const result = yield* dieOnDatabaseError(
          svc.getByType(
            params.type,
            omitUndefined({
              limit: query.limit ?? 20,
              offset: query.offset ?? 0,
              tag: query.tag,
            }),
          ),
        )

        const body = {
          data: result.data.map(toDateStrings),
          pagination: result.pagination,
        }

        const encoded = yield* Schema.encodeEffect(GetAudioByTypeResponse)(body).pipe(Effect.orDie)

        return HttpServerResponse.setHeader(
          yield* HttpServerResponse.json(encoded).pipe(Effect.orDie),
          'Cache-Control',
          'public, max-age=60, stale-while-revalidate=300',
        )
      }),
    )
    .handle('getAudioByTypeForEdit', ({ params, query }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* AudioService

        const result = yield* dieOnDatabaseError(
          svc.getByTypeForEdit(
            params.type,
            omitUndefined({
              limit: query.limit ?? 20,
              offset: query.offset ?? 0,
              tag: query.tag,
              sort: query.sort,
              order: query.order,
            }),
            user.id,
            user.role ?? 'user',
          ),
        )

        return {
          data: result.data.map(toDateStrings),
          pagination: result.pagination,
        }
      }),
    )
    .handle('getAudioPage', ({ params }) =>
      Effect.gen(function* () {
        const principal = yield* resolvePageSession()

        return yield* loadAudioPage(params.type, params.slug, principal)
      }),
    )
    .handle('getAudioBySlug', ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* getOptionalActor
        const svc = yield* AudioService

        const audio = yield* dieOnDatabaseError(
          svc
            .getBySlug(params.type, params.slug, actor)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toDateStrings(audio)
      }),
    )
    .handle('getAudioBySlugForEdit', ({ params }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* AudioService

        const audio = yield* dieOnDatabaseError(
          svc.getBySlugForEdit(params.type, params.slug, user.id, user.role || 'user').pipe(
            Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
            Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
          ),
        )

        return toDateStrings(audio)
      }),
    )
    .handle('updateAudioBySlug', ({ params, payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const { tags, creatorIds, artistIds, ...updateData } = payload
        const authority = yield* makeSessionCommandAuthority

        const svc = yield* AudioService

        const audio = yield* dieOnDatabaseError(
          svc
            .update(
              params.type,
              params.slug,
              user.id,
              user.role || 'user',
              omitUndefined({
                ...updateData,
                ...(tags && { tags: [...tags] }),
                ...(creatorIds && { creatorIds: [...creatorIds] }),
                ...(artistIds && { artistIds: [...artistIds] }),
              }),
            )
            .pipe(
              Effect.provideService(CommandAuthority, authority),
              Effect.catchTag('ConflictError', () => new HttpApiError.Conflict()),
              Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
              Effect.catchTag('S3Error', () => new HttpApiError.InternalServerError()),
              Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
              Effect.catchTag('ValidationError', () => new ValidationHttpError()),
            ),
        )

        return toDateStrings(audio)
      }),
    )
    .handle('createAudio', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const { creatorIds, idempotencyKey, ...audioData } = payload
        const finalCreatorIds = creatorIds?.length ? [...creatorIds] : [user.id]

        const svc = yield* AudioService

        const audio = yield* dieOnDatabaseError(
          svc
            .create(
              omitUndefined({
                ...audioData,
                tags: audioData.tags ? [...audioData.tags] : undefined,
              }),
              finalCreatorIds,
              { actorId: user.id, actorRole: user.role ?? 'user', idempotencyKey },
            )
            .pipe(
              Effect.catchTag('ConflictError', () => new HttpApiError.Conflict()),
              Effect.catchTag('S3Error', () => new HttpApiError.InternalServerError()),
              Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
              Effect.catchTag('ValidationError', () => new ValidationHttpError()),
            ),
        )

        return toDateStrings(audio)
      }),
    )
    .handle('trackAudioPlay', ({ params, request }) =>
      Effect.gen(function* () {
        const forwardedFor = request.headers['x-forwarded-for']

        const clientIp =
          forwardedFor?.split(',')[0]?.trim() || request.headers['x-real-ip'] || 'unknown'

        const svc = yield* AudioService

        return yield* dieOnDatabaseError(
          svc
            .trackPlay(params.id, clientIp)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )
      }),
    )
    .handle('getMixQRPdf', ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* getOptionalActor
        const audioSvc = yield* AudioService
        const qrSvc = yield* QRCodeService

        const mix = yield* dieOnDatabaseError(
          audioSvc
            .getBySlug('mix', params.slug, actor)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return yield* dieOnDatabaseError(
          qrSvc.generateMixQRPdf(
            omitUndefined({
              slug: mix.slug,
              title: mix.title,
              thumbnailUrl: mix.thumbnailUrl,
              creators: mix.artists?.length ? mix.artists : mix.creators,
            }),
          ),
        )
      }),
    ),
)
