import { Api } from '@gbfm/api/api'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { Effect, FileSystem } from 'effect'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import {
  dieOnDatabaseError as makeDieOnDatabaseError,
  dieOnPlatformError as makeDieOnPlatformError,
  dieOnS3Error as makeDieOnS3Error,
} from '@/http/handler-utils'
import { ConfigService } from '@/services/config.service'
import { makeMediaPublication } from '@/services/media-publication'
import { S3Service } from '@/services/s3.service'
import { ShowSubscriptionService } from '@/services/show.service'
import { ObjectStoreClient } from '@/services/storage/object-store-client'
import { UserService } from '@/services/user.service'

const dieOnDatabaseError = makeDieOnDatabaseError('user')

const dieOnS3Error = makeDieOnS3Error('user')

const dieOnPlatformError = makeDieOnPlatformError('user')

const sanitizeFileName = (value: string): string => value.replace(/\s+/g, '_')

// Multipart file fields decode to Multipart.PersistedFile -- a disk-backed
// reference (key/name/contentType/path), not a real in-memory File. Reading
// it means going through FileSystem.FileSystem, not .arrayBuffer() (see
// packages/api/src/upload.ts's comment on this same mismatch).
const uploadAvatar = (
  userId: string,
  avatarFile: { path: string; name: string; contentType: string },
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const bytes = yield* dieOnPlatformError(fs.readFile(avatarFile.path))
    const fileName = `avatar_${userId}_${Date.now()}_${sanitizeFileName(avatarFile.name)}`
    const contentType = avatarFile.contentType || 'application/octet-stream'

    const config = yield* ConfigService
    const s3Service = yield* S3Service
    yield* dieOnS3Error(
      s3Service.uploadFile(fileName, Buffer.from(bytes), contentType, config.buckets.userContent),
    )

    return `${config.urls.bucketRouter}/user-content/${fileName}`
  })

const requireAdmin = Effect.gen(function* () {
  const { user: sessionUser } = yield* AuthSession

  if (sessionUser.role !== 'admin') {
    return yield* new HttpApiError.Forbidden()
  }

  return undefined
})

type UserProfile = Effect.Success<ReturnType<UserService['getUserById']>>

type SocialLink = Effect.Success<ReturnType<UserService['getUserSocialLinks']>>[number]

interface UserProfileUpdate {
  email?: string
  image?: string | null
  username?: string
  bio?: string | null
}

interface UserBioUpdate {
  bio?: string | null
  image?: string | null
}

const toProfileResponse = (profile: UserProfile, socialLinks: ReadonlyArray<SocialLink>) => ({
  ...profile,
  avatarUrl: profile.image,
  verified: profile.emailVerified,
  socialLinks: [...socialLinks],
})

export const UserHandlersLive = HttpApiBuilder.group(Api, 'user', (handlers) =>
  handlers
    .handle('updateProfile', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const updateData: UserProfileUpdate = {}

        // Both branches of the payload union (JSON and multipart) share the
        // same email/username/bio fields; `avatar`/`image` only exist on one
        // side each, so a plain `in` check picks the right one at runtime --
        // HttpApiBuilder already routed us here based on the real
        // content-type header, so this isn't re-deriving that decision.
        if (payload.email) updateData.email = payload.email

        if (payload.username) updateData.username = payload.username

        if (payload.bio !== undefined) updateData.bio = payload.bio

        if ('image' in payload && payload.image !== undefined) updateData.image = payload.image

        if ('avatar' in payload && payload.avatar) {
          updateData.image = yield* uploadAvatar(user.id, payload.avatar)
        }

        const svc = yield* UserService
        const config = yield* ConfigService
        const store = yield* ObjectStoreClient

        const publication = yield* dieOnS3Error(
          makeMediaPublication(config, store)(updateData, {
            userId: user.id,
            userRole: user.role ?? 'user',
            credential: undefined,
          }).pipe(
            Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
            Effect.catchTag('ValidationError', () => new HttpApiError.BadRequest()),
          ),
        )

        const profile = yield* dieOnDatabaseError(
          svc
            .updateUserProfile(user.id, publication.data)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        yield* dieOnS3Error(publication.publish)

        const socialLinks = yield* dieOnDatabaseError(
          svc
            .getUserSocialLinks(user.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toProfileResponse(profile, socialLinks)
      }),
    )
    .handle('getProfile', () =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* UserService

        const profile = yield* dieOnDatabaseError(
          svc
            .getUserById(user.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        const socialLinks = yield* dieOnDatabaseError(
          svc
            .getUserSocialLinks(user.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toProfileResponse(profile, socialLinks)
      }),
    )
    .handle('getSocialLinks', () =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* UserService

        const links = yield* dieOnDatabaseError(
          svc
            .getUserSocialLinks(user.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return [...links]
      }),
    )
    .handle('replaceSocialLinks', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* UserService

        const links = yield* dieOnDatabaseError(
          svc
            .replaceUserSocialLinks(user.id, [...payload])
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return [...links]
      }),
    )
    .handle('getAdminUserSocialLinks', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* UserService

        const links = yield* dieOnDatabaseError(
          svc
            .getUserSocialLinks(params.userId)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return [...links]
      }),
    )
    .handle('replaceAdminUserSocialLinks', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* UserService

        const links = yield* dieOnDatabaseError(
          svc
            .replaceUserSocialLinks(params.userId, [...payload])
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return [...links]
      }),
    )
    .handle('updateAdminUserBio', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const updateData: UserBioUpdate = {}

        if (payload.bio !== null) updateData.bio = payload.bio

        if (payload.image !== undefined) updateData.image = payload.image

        const svc = yield* UserService
        const { user } = yield* AuthSession
        const config = yield* ConfigService
        const store = yield* ObjectStoreClient

        const publication = yield* dieOnS3Error(
          makeMediaPublication(config, store)(updateData, {
            userId: user.id,
            userRole: user.role ?? 'user',
            credential: undefined,
          }).pipe(
            Effect.catchTag('UnauthorizedError', () => new HttpApiError.Unauthorized()),
            Effect.catchTag('ValidationError', () => new HttpApiError.BadRequest()),
          ),
        )

        const updated = yield* dieOnDatabaseError(
          svc
            .updateUserProfile(params.userId, publication.data)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        yield* dieOnS3Error(publication.publish)

        return { bio: updated.bio }
      }),
    )
    .handle('getAdminUserBio', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* UserService

        const target = yield* dieOnDatabaseError(
          svc
            .getUserById(params.userId)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return { bio: target.bio }
      }),
    )
    .handle('getEmailPreferences', () =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* UserService
        const prefs = yield* dieOnDatabaseError(svc.getUserEmailPreferences(user.id))

        return {
          ...prefs,
          createdAt: prefs.createdAt.toISOString(),
          updatedAt: prefs.updatedAt.toISOString(),
        }
      }),
    )
    .handle('updateEmailPreferences', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* UserService
        const prefs = yield* dieOnDatabaseError(svc.updateUserEmailPreferences(user.id, payload))

        return {
          ...prefs,
          createdAt: prefs.createdAt.toISOString(),
          updatedAt: prefs.updatedAt.toISOString(),
        }
      }),
    )
    .handle('getUserSubscriptions', ({ query }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession
        const svc = yield* ShowSubscriptionService

        const result = yield* dieOnDatabaseError(
          svc.getUserSubscriptions(user.id, {
            limit: query.limit ?? 20,
            offset: query.offset ?? 0,
          }),
        )

        return {
          data: result.data.map((subscription) => ({
            ...subscription,
            createdAt: subscription.createdAt.toISOString(),
            show: {
              ...subscription.show,
              createdAt: subscription.show.createdAt.toISOString(),
              updatedAt: subscription.show.updatedAt.toISOString(),
            },
          })),
          pagination: result.pagination,
        }
      }),
    )
    .handle('listDjs', () =>
      Effect.gen(function* () {
        const svc = yield* UserService

        return yield* dieOnDatabaseError(svc.listDjs())
      }),
    )
    .handle('searchUsers', ({ query }) =>
      Effect.gen(function* () {
        const svc = yield* UserService

        return yield* dieOnDatabaseError(svc.searchUsers(query.q))
      }),
    ),
)
