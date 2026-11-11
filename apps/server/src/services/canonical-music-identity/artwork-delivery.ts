import { Context, Effect, Option, Schema } from 'effect'

import type { ConfigService } from '@/services/config.service'
import type { S3Service } from '@/services/s3.service'

import type {
  AnyResolvedMusicEntity,
  ArtworkDelivery,
  MusicIdentityAuthorization,
} from './contract'
import { MusicIdentityArtworkDeliveryFailed, type MusicIdentityError } from './errors'
import type { CanonicalMusicIdentityRepository, EntityReference } from './repository'
import { withSafeTypedSpan } from './telemetry'

const MAX_MUSIC_ARTWORK_SIZE = 10 * 1024 * 1024

const APPROVED_MUSIC_ARTWORK_HOSTS = new Set([
  'archive.org',
  'coverartarchive.org',
  'i.scdn.co',
  'images-na.ssl-images-amazon.com',
  'img.youtube.com',
  'm.media-amazon.com',
  'mosaic.scdn.co',
  'resources.tidal.com',
])

const APPROVED_MUSIC_ARTWORK_HOST_SUFFIXES = [
  '.archive.org',
  '.bcbits.com',
  '.dzcdn.net',
  '.mzstatic.com',
  '.sndcdn.com',
  '.spotifycdn.com',
  '.ytimg.com',
]

const APPROVED_MUSIC_ARTWORK_CONTENT_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export type MusicCoverImageFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export const MusicCoverImageFetcher = Context.Reference<MusicCoverImageFetch>(
  'MusicCoverImageFetcher',
  { defaultValue: () => fetch },
)

const isApprovedArtworkUrl = (source: string) => {
  const url = URL.parse(source)

  if (!url || url.protocol !== 'https:') return false

  const hostname = url.hostname.toLowerCase()

  return (
    APPROVED_MUSIC_ARTWORK_HOSTS.has(hostname) ||
    APPROVED_MUSIC_ARTWORK_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  )
}

class MusicArtworkBodyTooLarge extends Schema.TaggedError<MusicArtworkBodyTooLarge>()(
  'MusicArtworkBodyTooLarge',
  {},
) {}

const readResponseBody = async (response: Response): Promise<Uint8Array> => {
  if (!response.body) throw new Error('Music artwork response has no body')

  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let size = 0

  try {
    while (true) {
      const result = await reader.read()

      if (result.done) break

      size += result.value.byteLength

      if (size > MAX_MUSIC_ARTWORK_SIZE) {
        await reader.cancel().catch(() => undefined)
        throw new MusicArtworkBodyTooLarge({})
      }

      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }

  if (size === 0) throw new Error('Music artwork response is empty')

  const bytes = new Uint8Array(size)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

class ImportArtworkFetchUnavailable extends Schema.TaggedError<ImportArtworkFetchUnavailable>()(
  'ImportArtworkFetchUnavailable',
  {},
) {}

export const fetchImportMusicArtwork = (
  fetcher: MusicCoverImageFetch,
  candidateUrl: string,
  ownedArtworkPrefix: URL,
) =>
  Effect.tryPromise({
    try: async (signal) => {
      const approved = (value: string) => {
        if (isApprovedArtworkUrl(value)) return true
        const url = URL.parse(value)

        return (
          url !== null &&
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          url.origin === ownedArtworkPrefix.origin &&
          url.pathname.startsWith(ownedArtworkPrefix.pathname)
        )
      }

      if (!approved(candidateUrl)) return null
      const response = await fetcher(candidateUrl, { redirect: 'error', signal })

      if (response.status === 429 || response.status >= 500)
        throw new Error('Artwork source temporarily unavailable')

      if (!response.ok || (response.url && !approved(response.url))) return null

      const contentType = Schema.decodeUnknownOption(
        Schema.Literals(['image/jpeg', 'image/png', 'image/webp']),
      )(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase())

      if (Option.isNone(contentType)) return null
      const length = Number(response.headers.get('content-length'))

      if (Number.isFinite(length) && length > MAX_MUSIC_ARTWORK_SIZE) return null

      return { bytes: await readResponseBody(response), contentType: contentType.value }
    },
    catch: (cause) =>
      cause instanceof MusicArtworkBodyTooLarge ? cause : new ImportArtworkFetchUnavailable({}),
  }).pipe(Effect.catchTag('MusicArtworkBodyTooLarge', () => Effect.succeed(null)))

const fetchArtwork = (fetcher: MusicCoverImageFetch, candidateUrl: string) =>
  Effect.gen(function* () {
    if (!isApprovedArtworkUrl(candidateUrl)) return undefined

    const response = yield* Effect.tryPromise(() =>
      fetcher(candidateUrl, { redirect: 'follow' }),
    ).pipe(Effect.catch(() => Effect.succeed(undefined)))

    if (!response || !response.ok || (response.url && !isApprovedArtworkUrl(response.url))) {
      return undefined
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()

    if (!contentType || !APPROVED_MUSIC_ARTWORK_CONTENT_TYPES.has(contentType)) return undefined

    const contentLength = Number(response.headers.get('content-length'))

    if (Number.isFinite(contentLength) && contentLength > MAX_MUSIC_ARTWORK_SIZE) return undefined

    const bytes = yield* Effect.tryPromise(() => readResponseBody(response)).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )

    return bytes ? { bytes, contentType } : undefined
  })

type ReloadResolved = (
  reference: EntityReference,
  created: boolean,
) => Effect.Effect<AnyResolvedMusicEntity, MusicIdentityError>

type ArtworkDeliveryDependencies = {
  readonly s3: Pick<S3Service, 'uploadFile'>
  readonly config: ConfigService
  readonly fetcher: MusicCoverImageFetch
  readonly repository: CanonicalMusicIdentityRepository
  readonly reload: ReloadResolved
}

type DeliverMusicArtworkInput = {
  readonly resolved: AnyResolvedMusicEntity
  readonly candidateUrl: string | undefined | null
  readonly delivery: ArtworkDelivery
  readonly authorize?: MusicIdentityAuthorization | undefined
}

export const buildDeliverMusicArtwork =
  ({ s3, config, fetcher, repository, reload }: ArtworkDeliveryDependencies) =>
  ({ resolved, candidateUrl, delivery, authorize }: DeliverMusicArtworkInput) =>
    Effect.gen(function* () {
      const reference = {
        entityType: resolved.entityType,
        entityId: resolved.entity.id,
      } satisfies EntityReference

      if (delivery === 'preserve' || !candidateUrl) return resolved

      if (authorize) yield* authorize(reference.entityType)
      const artwork = yield* fetchArtwork(fetcher, candidateUrl)

      if (!artwork) return resolved

      const key = `music/${reference.entityType}/${reference.entityId}/cover`

      if (authorize) yield* authorize(reference.entityType)

      const upload = s3
        .uploadFile(key, artwork.bytes, artwork.contentType, config.buckets.userContent)
        .pipe(
          Effect.mapError(
            () =>
              new MusicIdentityArtworkDeliveryFailed({
                entityType: reference.entityType,
                entityId: reference.entityId,
                operation: 'upload',
                message: 'Music artwork upload failed',
              }),
          ),
        )

      const publicArtworkUrl =
        delivery === 'best_effort'
          ? yield* upload.pipe(
              Effect.catchTag('MusicIdentityArtworkDeliveryFailed', (error) =>
                Effect.andThen(
                  Effect.logWarning('[CanonicalMusicIdentity] Artwork delivery failed', {
                    entityType: error.entityType,
                    entityId: error.entityId,
                    delivery,
                    errorTag: error._tag,
                  }),
                  Effect.succeed(undefined),
                ),
              ),
            )
          : yield* upload

      if (!publicArtworkUrl) return resolved

      const storedArtworkUrl = `${config.urls.bucketRouter}/user-content/${publicArtworkUrl}`

      if (authorize) yield* authorize(reference.entityType)
      yield* repository.updateArtwork(reference, storedArtworkUrl)

      return yield* reload(reference, resolved.created)
    }).pipe(
      Effect.tap(() =>
        Effect.annotateCurrentSpan({
          entityType: resolved.entityType,
          entityId: resolved.entity.id,
          delivery,
          outcome: 'success',
        }),
      ),
      withSafeTypedSpan('musicIdentity.artwork'),
    )
