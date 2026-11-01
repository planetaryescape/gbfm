import { PostMusicResolutionError, ResolvePostMusicResponse } from '@gbfm/api/post'
import { RichContentDocument } from '@gbfm/rich-content/schema'
import { Context, Data, Effect, Layer, Option, Schema } from 'effect'

export type CreatorKind = 'micro' | 'post' | 'mix'

export const CreatorDraftSchema = Schema.Struct({
  kind: Schema.Literals(['micro', 'post', 'mix']),
  editSlug: Schema.NullOr(Schema.String),
  postId: Schema.optional(Schema.String),
  title: Schema.String,
  slug: Schema.String,
  content: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  creatorIds: Schema.Array(Schema.String),
  thumbnailUrl: Schema.String,
  musicUrl: Schema.String,
  musicEntityType: Schema.NullOr(Schema.Literals(['album', 'track', 'playlist'])),
  musicEntityId: Schema.NullOr(Schema.String),
  quotedPostId: Schema.NullOr(Schema.String),
  quoteUrl: Schema.String,
  audioUrl: Schema.String,
  showId: Schema.NullOr(Schema.String),
  episodeNumber: Schema.NullOr(Schema.Number),
})

export type CreatorDraft = typeof CreatorDraftSchema.Type

export class CreatorRequestError extends Data.TaggedError('CreatorRequestError')<{
  readonly operation: string
  readonly status: number | null
  readonly message: string
}> {}

export class CreatorStorageError extends Data.TaggedError('CreatorStorageError')<{
  readonly operation: 'read' | 'write' | 'clear'
  readonly message: string
}> {}

export class CreatorUploadError extends Data.TaggedError('CreatorUploadError')<{
  readonly stage: 'init' | 'presign' | 'part' | 'complete' | 'image'
  readonly status: number | null
  readonly message: string
}> {}

export type CreatorError = CreatorRequestError | CreatorStorageError | CreatorUploadError

export const CreatorIdentity = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  username: Schema.NullOr(Schema.String),
})

export const MusicReference = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.NullOr(Schema.String),
  content: Schema.NullOr(Schema.String),
  creators: Schema.Array(CreatorIdentity),
})

const MusicReferencesResponse = Schema.Struct({
  data: Schema.Array(MusicReference),
  pagination: Schema.Struct({ hasMore: Schema.Boolean }),
})

export interface EditableContent extends CreatorDraft {
  readonly draft: boolean
  readonly creators: ReadonlyArray<typeof CreatorIdentity.Type>
}

export interface SaveInput {
  readonly draft: CreatorDraft
  readonly creatorId: string
  readonly publish: boolean
}

export interface CreatorOperations {
  readonly findMusicReferences: (
    entityType: 'album' | 'track' | 'playlist',
    entityId: string,
    offset: number,
  ) => Effect.Effect<typeof MusicReferencesResponse.Type, CreatorRequestError>
  readonly searchAuthors: (
    query: string,
  ) => Effect.Effect<ReadonlyArray<typeof CreatorIdentity.Type>, CreatorRequestError>
  readonly readLocalDraft: (key: string) => Effect.Effect<CreatorDraft | null, CreatorStorageError>
  readonly writeLocalDraft: (
    key: string,
    draft: CreatorDraft,
  ) => Effect.Effect<void, CreatorStorageError>
  readonly clearLocalDraft: (key: string) => Effect.Effect<void, CreatorStorageError>
  readonly loadEditable: (
    kind: CreatorKind,
    slug: string,
  ) => Effect.Effect<EditableContent, CreatorRequestError>
  readonly resolveMusic: (
    url: string,
    kind: CreatorKind,
  ) => Effect.Effect<
    {
      readonly entityType: 'album' | 'track' | 'playlist'
      readonly entityId: string
      readonly title: string
      readonly artistNames: ReadonlyArray<string>
      readonly coverImageUrl: string | null
    },
    CreatorRequestError
  >
  readonly resolveQuote: (slug: string) => Effect.Effect<
    {
      readonly id: string
      readonly slug: string
      readonly title: string | null
      readonly content: string | null
    },
    CreatorRequestError
  >
  readonly resolvePostMusic: (
    postId: string,
    url: string,
  ) => Effect.Effect<typeof ResolvePostMusicResponse.Type, CreatorRequestError>
  readonly save: (
    input: SaveInput,
  ) => Effect.Effect<{ readonly id: string; readonly slug: string }, CreatorRequestError>
  readonly renderPreview: (
    content: string,
  ) => Effect.Effect<typeof RichContentDocument.Type, CreatorRequestError>
  readonly uploadImage: (file: File) => Effect.Effect<string, CreatorUploadError>
  readonly generateMosaic: (content: string) => Effect.Effect<File, CreatorRequestError>
}

export class CreatorService extends Context.Service<CreatorService, CreatorOperations>()(
  '@gbfm/www/CreatorService',
) {}

const EditableResponse = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  slug: Schema.String,
  content: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  tags: Schema.NullOr(Schema.Array(Schema.String)),
  thumbnailUrl: Schema.NullOr(Schema.String),
  type: Schema.NullOr(Schema.String),
  musicEntityType: Schema.optional(Schema.NullOr(Schema.String)),
  musicEntityId: Schema.optional(Schema.NullOr(Schema.String)),
  quotedPostId: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  showId: Schema.optional(Schema.NullOr(Schema.String)),
  episodeNumber: Schema.optional(Schema.NullOr(Schema.Number)),
  creators: Schema.optional(Schema.Array(CreatorIdentity)),
})

const SavedResponse = Schema.Struct({ id: Schema.String, slug: Schema.String })

const MusicResponse = Schema.Struct({
  entityType: Schema.String,
  entity: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    artistNames: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  }),
  coverImageUrl: Schema.NullOr(Schema.String),
})

const QuoteResponse = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.NullOr(Schema.String),
  content: Schema.NullOr(Schema.String),
})

const PreviewResponse = Schema.Struct({ richContent: RichContentDocument })

const ImageResponse = Schema.Struct({
  uploadUrl: Schema.String,
  publicUrl: Schema.String,
  key: Schema.String,
})

const requestJson = <A>(
  operation: string,
  schema: Schema.Codec<A, unknown, never, unknown>,
  path: string,
  init?: RequestInit,
): Effect.Effect<A, CreatorRequestError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`/api${path}`, { credentials: 'include', ...init, signal })

      if (!response.ok) {
        let message = 'The content request failed.'

        if (operation === 'resolve post music') {
          if (response.status === 503 || response.status === 429) {
            const retryAfter = Number(response.headers.get('retry-after'))
            message = `Music providers are busy or temporarily unavailable. Try again${retryAfter > 0 ? ` in ${retryAfter} seconds` : ' later'}.`
          } else if (response.status === 422) {
            const error = Schema.decodeUnknownOption(PostMusicResolutionError)(
              await response.json(),
            )

            if (Option.isSome(error)) message = error.value.message
          } else if (response.status === 401 || response.status === 403) {
            message = 'You do not have permission to resolve music for this post.'
          } else if (response.status === 409) {
            message = 'The post or music identity changed. Reload and try again.'
          } else if (response.status === 400) {
            message =
              'This music link could not be resolved. Check the URL and try another album, track or playlist link.'
          } else if (response.status === 404) {
            message = 'The post or music entity was not found. Reload and try again.'
          }
        }

        throw new CreatorRequestError({
          operation,
          status: response.status,
          message,
        })
      }

      return response.json()
    },
    catch: (cause) =>
      cause instanceof CreatorRequestError
        ? cause
        : new CreatorRequestError({
            operation,
            status: null,
            message: 'Could not reach the content API.',
          }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError((cause) =>
      cause instanceof CreatorRequestError
        ? cause
        : new CreatorRequestError({
            operation,
            status: null,
            message: 'The content API returned an invalid response.',
          }),
    ),
  )

type JsonBody = Readonly<Record<string, Schema.Json | undefined>>

const json = (body: JsonBody): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const draftKey = (key: string) => `gbfm:creator:${key}`

export const CreatorServiceLive = Layer.succeed(CreatorService, {
  generateMosaic: (content) =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch('/actions/mosaic', {
          method: 'POST',
          credentials: 'include',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content }),
        })

        if (!response.ok)
          throw new CreatorRequestError({
            operation: 'generate mosaic',
            status: response.status,
            message:
              response.status === 422
                ? 'No usable images found. Add album artwork or images from a supported image host. Private uploads are not used.'
                : response.status === 401 || response.status === 403
                  ? 'Sign in with permission to create posts before generating artwork.'
                  : 'Could not generate the mosaic. Your existing artwork has not changed.',
          })

        if (response.headers.get('content-type') !== 'image/png')
          throw new CreatorRequestError({
            operation: 'generate mosaic',
            status: null,
            message: 'The mosaic service returned an invalid image.',
          })
        const revision = response.headers.get('x-mosaic-revision')

        if (!revision || !/^[a-f0-9]{16}$/.test(revision))
          throw new CreatorRequestError({
            operation: 'generate mosaic',
            status: null,
            message: 'The mosaic service returned an invalid revision.',
          })

        return new File([await response.blob()], `mosaic-${revision}.png`, { type: 'image/png' })
      },
      catch: (cause) =>
        cause instanceof CreatorRequestError
          ? cause
          : new CreatorRequestError({
              operation: 'generate mosaic',
              status: null,
              message: 'Could not reach the mosaic service. Your existing artwork has not changed.',
            }),
    }),
  findMusicReferences: (entityType, entityId, offset) =>
    requestJson(
      'find music references',
      MusicReferencesResponse,
      `/content/posts/micro?${new URLSearchParams({ musicEntityType: entityType, musicEntityId: entityId, limit: '20', offset: String(offset) })}`,
    ),
  searchAuthors: (query) =>
    requestJson(
      'search authors',
      Schema.Array(CreatorIdentity),
      `/user/search?q=${encodeURIComponent(query)}`,
    ),
  readLocalDraft: (key) =>
    Effect.try({
      try: () => localStorage.getItem(draftKey(key)),
      catch: () => new CreatorStorageError({ operation: 'read', message: 'Could not read draft.' }),
    }).pipe(
      Effect.flatMap((value) =>
        value === null
          ? Effect.succeed(null)
          : Schema.decodeUnknownEffect(Schema.fromJsonString(CreatorDraftSchema))(value),
      ),
      Effect.mapError(
        () => new CreatorStorageError({ operation: 'read', message: 'Could not restore draft.' }),
      ),
    ),
  writeLocalDraft: (key, draft) =>
    Effect.try({
      try: () => localStorage.setItem(draftKey(key), JSON.stringify(draft)),
      catch: (cause) => new CreatorStorageError({ operation: 'write', message: String(cause) }),
    }),
  clearLocalDraft: (key) =>
    Effect.try({
      try: () => localStorage.removeItem(draftKey(key)),
      catch: (cause) => new CreatorStorageError({ operation: 'clear', message: String(cause) }),
    }),
  loadEditable: (kind, slug) =>
    requestJson(
      'load editable content',
      EditableResponse,
      kind === 'mix'
        ? `/content/audio/mix/${encodeURIComponent(slug)}/edit`
        : `/content/posts/${encodeURIComponent(slug)}/edit`,
    ).pipe(
      Effect.map((item): EditableContent => ({
        kind: kind === 'mix' ? 'mix' : item.type === 'post' ? 'post' : 'micro',
        editSlug: slug,
        postId: kind === 'mix' ? undefined : item.id,
        title: item.title ?? '',
        slug: item.slug,
        content: item.content ?? '',
        description: item.description ?? '',
        tags: item.tags ?? [],
        thumbnailUrl: item.thumbnailUrl ?? '',
        musicUrl: '',
        musicEntityType:
          item.musicEntityType === 'album' ||
          item.musicEntityType === 'track' ||
          item.musicEntityType === 'playlist'
            ? item.musicEntityType
            : null,
        musicEntityId: item.musicEntityId ?? null,
        quotedPostId: item.quotedPostId ?? null,
        quoteUrl: '',
        audioUrl: item.url ?? '',
        showId: item.showId ?? null,
        episodeNumber: item.episodeNumber ?? null,
        creatorIds: (item.creators ?? []).map(({ id }) => id),
        creators: item.creators ?? [],
        draft: item.draft ?? false,
      })),
    ),
  resolveMusic: (url, kind) =>
    requestJson(
      'resolve music',
      MusicResponse,
      '/music/resolve',
      json({ url, origin: kind === 'post' ? 'editorial' : 'tweet' }),
    ).pipe(
      Effect.flatMap(({ entityType, entity, coverImageUrl }) =>
        entityType === 'album' || entityType === 'track' || entityType === 'playlist'
          ? Effect.succeed({
              entityType,
              entityId: entity.id,
              title: entity.title,
              artistNames: entity.artistNames ?? [],
              coverImageUrl,
            })
          : Effect.fail(
              new CreatorRequestError({
                operation: 'resolve music',
                status: 422,
                message: 'Artist links cannot be attached.',
              }),
            ),
      ),
    ),
  resolvePostMusic: (postId, url) =>
    requestJson(
      'resolve post music',
      ResolvePostMusicResponse,
      `/content/posts/${encodeURIComponent(postId)}/resolve-music-entity`,
      json(url.trim() ? { url: url.trim() } : {}),
    ),
  resolveQuote: (slug) =>
    requestJson(
      'resolve quoted tweet',
      QuoteResponse,
      `/content/posts/micro/${encodeURIComponent(slug)}`,
    ),
  renderPreview: (content) =>
    requestJson(
      'render preview',
      PreviewResponse,
      '/content/posts/preview',
      json({ content }),
    ).pipe(Effect.map(({ richContent }) => richContent)),
  save: ({ draft, creatorId, publish }) => {
    const slug =
      draft.slug ||
      `${
        draft.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || draft.kind
      }-${Date.now().toString(36)}`

    const payload =
      draft.kind === 'mix'
        ? {
            title: draft.title,
            slug,
            description: draft.description,
            content: draft.content,
            thumbnailUrl: draft.thumbnailUrl,
            url: draft.audioUrl,
            type: 'mix',
            draft: !publish,
            tags: draft.tags,
            idempotencyKey: draft.editSlug ? undefined : crypto.randomUUID(),
            creatorIds: draft.creatorIds.length ? draft.creatorIds : [creatorId],
            showId: draft.showId ?? undefined,
            episodeNumber: draft.episodeNumber ?? undefined,
          }
        : {
            title: draft.title.trim() || null,
            slug,
            description: draft.kind === 'post' ? draft.description : undefined,
            content: draft.content.trim() || null,
            thumbnailUrl: draft.thumbnailUrl,
            tags: draft.tags,
            draft: !publish,
            type: draft.kind,
            creatorIds: draft.creatorIds.length ? draft.creatorIds : [creatorId],
            musicEntityType: draft.musicEntityType,
            musicEntityId: draft.musicEntityId,
            quotedPostId: draft.editSlug ? undefined : draft.quotedPostId,
          }

    const path = draft.editSlug
      ? draft.kind === 'mix'
        ? `/content/audio/mix/${encodeURIComponent(draft.editSlug)}`
        : `/content/posts/${encodeURIComponent(draft.editSlug)}`
      : draft.kind === 'mix'
        ? '/content/audio'
        : '/content/post'

    return requestJson('save content', SavedResponse, path, {
      ...json(payload),
      method: draft.editSlug ? 'PATCH' : 'POST',
    })
  },
  uploadImage: (file) =>
    Effect.gen(function* () {
      const signed = yield* requestJson(
        'presign image',
        ImageResponse,
        '/upload/image/presign',
        json({ fileName: file.name, contentType: file.type, fileSize: file.size }),
      ).pipe(
        Effect.mapError(
          (error) =>
            new CreatorUploadError({
              stage: 'image',
              status: error.status,
              message: error.message,
            }),
        ),
      )

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(signed.uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'content-type': file.type },
          }),
        catch: (cause) =>
          new CreatorUploadError({ stage: 'image', status: null, message: String(cause) }),
      })

      if (!response.ok)
        return yield* new CreatorUploadError({
          stage: 'image',
          status: response.status,
          message: 'Artwork upload failed',
        })

      return signed.publicUrl
    }),
} satisfies CreatorOperations)
