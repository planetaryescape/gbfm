import type { UserId } from '@gbfm/core/identity'
import { Context, Effect, Layer, Match } from 'effect'

import { Database } from '@/db/layer'
import { S3Error, UnauthorizedError } from '@/errors'
import { ConfigService } from '@/services/config.service'
import { attachedMediaUrls, makeMediaPublication } from '@/services/media-publication'
import { ObjectStoreClient } from '@/services/storage/object-store-client'
import { keyFromAssetUrl } from '@/services/upload-asset.service'

import { EditorialToolError } from '../contracts'
import { loadOwnedEditorialPost, type EditorialPatch } from '../editorial-music/save'
import type { EditorialSnapshot } from '../editorial-music/snapshot'
import { unavailable } from '../model'

const failure = (error: { readonly _tag: string }) =>
  Match.value(error._tag).pipe(
    Match.when('S3Error', unavailable),
    Match.orElse(
      () =>
        new EditorialToolError({
          code: 'invalid_input',
          message: 'Invalid or unauthorized private media.',
        }),
    ),
  )

export class PostEditPublication extends Context.Service<
  PostEditPublication,
  {
    readonly prepare: (
      previous: EditorialSnapshot,
      patch: EditorialPatch,
      actorId: UserId,
    ) => Effect.Effect<EditorialPatch, EditorialToolError>
    readonly preparePublish: (
      previous: EditorialSnapshot,
      actorId: UserId,
    ) => Effect.Effect<
      {
        readonly patch: {
          readonly content: string | null
          readonly thumbnailUrl: string | null
          readonly bannerImageUrl: string | null
        }
        readonly assetKeys: ReadonlyArray<string>
      },
      EditorialToolError
    >
    readonly complete: (
      postId: EditorialSnapshot['id'],
      actorId: UserId,
      authorize: Effect.Effect<unknown, EditorialToolError>,
    ) => Effect.Effect<void, EditorialToolError>
  }
>()('gbfm/mcp/PostEditPublication') {}

export const PostEditPublicationLayer = Layer.effect(
  PostEditPublication,
  Effect.gen(function* () {
    const db = yield* Database
    const config = yield* ConfigService
    const store = yield* ObjectStoreClient
    const media = makeMediaPublication(config, store)

    const prepare = (previous: EditorialSnapshot, patch: EditorialPatch, actorId: UserId) =>
      Effect.gen(function* () {
        const publication = yield* media(
          { ...patch, draft: previous.draft },
          { userId: actorId, userRole: 'creator', credential: undefined },
          previous,
        ).pipe(Effect.mapError(failure))

        const data = publication.data

        const next: EditorialPatch = {
          title: data.title,
          content: data.content,
          description: data.description,
        }

        return {
          ...next,
          ...(data.thumbnailUrl === undefined ? undefined : { thumbnailUrl: data.thumbnailUrl }),
          ...(data.bannerImageUrl === undefined
            ? undefined
            : { bannerImageUrl: data.bannerImageUrl }),
        }
      })

    const complete = (
      postId: EditorialSnapshot['id'],
      actorId: UserId,
      authorize: Effect.Effect<unknown, EditorialToolError>,
    ) =>
      Effect.gen(function* () {
        yield* authorize
        const current = yield* loadOwnedEditorialPost(db, postId, actorId)

        if (current.draft) return yield* Effect.void

        const publication = yield* media(
          {
            content: current.content,
            thumbnailUrl: current.thumbnailUrl,
            bannerImageUrl: current.bannerImageUrl,
            draft: false,
          },
          { userId: actorId, userRole: 'creator', credential: undefined },
          current,
          (_source, destination) =>
            Effect.gen(function* () {
              yield* authorize
              const latest = yield* loadOwnedEditorialPost(db, postId, actorId)

              if (latest.draft || !attachedMediaUrls(latest).includes(destination))
                yield* new UnauthorizedError({
                  message: 'Media is no longer publicly attached.',
                })
            }).pipe(
              Effect.mapError(
                () =>
                  new S3Error({
                    message: 'Media publication access denied.',
                    operation: 'publish media',
                  }),
              ),
            ),
        ).pipe(Effect.mapError(failure))

        yield* publication.publish.pipe(Effect.mapError(failure))
        yield* authorize
        yield* loadOwnedEditorialPost(db, postId, actorId)

        return yield* Effect.void
      })

    const preparePublish = (previous: EditorialSnapshot, actorId: UserId) =>
      Effect.gen(function* () {
        const publication = yield* media(
          {
            content: previous.content,
            thumbnailUrl: previous.thumbnailUrl,
            bannerImageUrl: previous.bannerImageUrl,
            draft: false,
          },
          { userId: actorId, userRole: 'creator', credential: undefined },
          previous,
        ).pipe(Effect.mapError(failure))

        const { content, thumbnailUrl, bannerImageUrl } = publication.data

        const assetKeys = attachedMediaUrls(publication.data).flatMap((url) => {
          const key = keyFromAssetUrl(url, config.urls.bucketRouter)

          if (key === null) return []

          return [key.startsWith('public/') ? `private/${key.slice('public/'.length)}` : key]
        })

        return { patch: { content, thumbnailUrl, bannerImageUrl }, assetKeys }
      })

    return PostEditPublication.of({ prepare, preparePublish, complete })
  }),
)
