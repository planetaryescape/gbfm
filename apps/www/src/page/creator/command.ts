import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'

import { Message } from './message'
import { keyOf, Kind } from './model'
import type { CreatorDraft, CreatorError } from './services'
import { CreatorDraftSchema as Draft, CreatorService } from './services'
import { CreatorUpload } from './upload/runtime'

const failure = (operation: string) => (error: CreatorError) =>
  Message.Failed({ operation, message: error.message })

export const FindMusicReferences = Command.define('Creator.FindMusicReferences', {
  args: {
    requestId: Schema.Number,
    entityType: Schema.Literals(['album', 'track', 'playlist']),
    entityId: Schema.String,
    offset: Schema.Number,
  },
  messages: [Message.MusicReferencesLoaded, Message.MusicReferencesFailed],
  execute: ({ requestId, entityType, entityId, offset }) =>
    Effect.flatMap(CreatorService, (service) =>
      service.findMusicReferences(entityType, entityId, offset),
    ).pipe(
      Effect.map(({ data, pagination }) =>
        Message.MusicReferencesLoaded({
          requestId,
          entityType,
          entityId,
          offset,
          references: data,
          hasMore: pagination.hasMore,
        }),
      ),
      Effect.catch(() =>
        Effect.succeed(Message.MusicReferencesFailed({ requestId, entityType, entityId })),
      ),
    ),
})

export const SearchAuthors = Command.define('Creator.SearchAuthors', {
  args: { query: Schema.String },
  messages: [Message.AuthorsFound, Message.AuthorSearchFailed],
  execute: ({ query }) =>
    Effect.flatMap(CreatorService, (service) => service.searchAuthors(query)).pipe(
      Effect.map((creators) => Message.AuthorsFound({ query, creators: [...creators] })),
      Effect.catch(() => Effect.succeed(Message.AuthorSearchFailed({ query }))),
    ),
})

export const Diagnose = Command.define('Creator.Diagnose', {
  args: { content: Schema.String },
  messages: [Message.DiagnosticsLoaded, Message.DiagnosticsFailed],
  execute: ({ content }) =>
    Effect.tryPromise(() => import('@gbfm/rich-content/source')).pipe(
      Effect.map(({ parseRichContent }) =>
        Message.DiagnosticsLoaded({
          content,
          diagnostics: [...parseRichContent(content).diagnostics],
        }),
      ),
      Effect.catch(() => Effect.succeed(Message.DiagnosticsFailed({ content }))),
    ),
})

export const PersistDraft = Command.define('Creator.PersistDraft', {
  args: { key: Schema.String, draft: Draft },
  messages: [Message.LocallySaved, Message.Failed],
  execute: ({ key, draft }) =>
    Effect.flatMap(CreatorService, (service) => service.writeLocalDraft(key, draft)).pipe(
      Effect.as(Message.LocallySaved()),
      Effect.catch((error) => Effect.succeed(failure('autosave')(error))),
    ),
})

export const Hydrate = Command.define('Creator.Hydrate', {
  args: { key: Schema.String, kind: Kind, editSlug: Schema.NullOr(Schema.String) },
  messages: [Message.Hydrated, Message.Failed],
  execute: ({ key, kind, editSlug }) =>
    Effect.gen(function* () {
      const service = yield* CreatorService

      const editable = editSlug ? yield* service.loadEditable(kind, editSlug) : null
      const draft: CreatorDraft | null = editable ?? (yield* service.readLocalDraft(key))

      return Message.Hydrated({ draft, creators: editable?.creators ?? [] })
    }).pipe(Effect.catch((error) => Effect.succeed(failure('load')(error)))),
})

export const ResolveMusic = Command.define('Creator.ResolveMusic', {
  args: { url: Schema.String, kind: Kind },
  messages: [Message.MusicResolved, Message.Failed],
  execute: ({ url, kind }) =>
    Effect.flatMap(CreatorService, (service) => service.resolveMusic(url, kind)).pipe(
      Effect.map(({ entityType, entityId, title, artistNames, coverImageUrl }) =>
        Message.MusicResolved({
          entityType,
          entityId,
          url,
          title,
          artistNames: [...artistNames],
          coverImageUrl,
        }),
      ),
      Effect.catch((error) => Effect.succeed(failure('resolve music')(error))),
    ),
})

export const ResolvePostMusic = Command.define('Creator.ResolvePostMusic', {
  args: { postId: Schema.String, url: Schema.String },
  messages: [Message.PostMusicResolved, Message.PostMusicFailed],
  execute: ({ postId, url }) =>
    Effect.flatMap(CreatorService, (service) => service.resolvePostMusic(postId, url)).pipe(
      Effect.map(Message.PostMusicResolved),
      Effect.catch((error) =>
        Effect.succeed(Message.PostMusicFailed({ postId, message: error.message })),
      ),
    ),
})

export const ResolveQuote = Command.define('Creator.ResolveQuote', {
  args: { slug: Schema.String },
  messages: [Message.QuoteResolved, Message.Failed],
  execute: ({ slug }) =>
    Effect.flatMap(CreatorService, (service) => service.resolveQuote(slug)).pipe(
      Effect.map(({ id, title, content }) => Message.QuoteResolved({ id, slug, title, content })),
      Effect.catch((error) => Effect.succeed(failure('resolve quote')(error))),
    ),
})

export const RenderPreview = Command.define('Creator.RenderPreview', {
  args: { content: Schema.String },
  messages: [Message.PreviewLoaded, Message.PreviewFailed],
  execute: ({ content }) =>
    Effect.flatMap(CreatorService, (service) => service.renderPreview(content)).pipe(
      Effect.map((document) => Message.PreviewLoaded({ content, document })),
      Effect.catch(() => Effect.succeed(Message.PreviewFailed({ content }))),
    ),
})

export const Save = Command.define('Creator.Save', {
  args: { draft: Draft, creatorId: Schema.String, publish: Schema.Boolean },
  messages: [Message.Saved, Message.Failed],
  execute: ({ draft, creatorId, publish }) =>
    Effect.gen(function* () {
      const service = yield* CreatorService
      const { id, slug } = yield* service.save({ draft, creatorId, publish })

      yield* service.clearLocalDraft(keyOf(draft))

      return Message.Saved({ id, slug, published: publish })
    }).pipe(Effect.catch((error) => Effect.succeed(failure('save')(error)))),
})

export const UploadArtwork = Command.define('Creator.UploadArtwork', {
  args: { file: Schema.instanceOf(File) },
  messages: [Message.ArtworkUploaded, Message.Failed],
  execute: ({ file }) =>
    Effect.flatMap(CreatorService, (service) => service.uploadImage(file)).pipe(
      Effect.map((url) => Message.ArtworkUploaded({ url })),
      Effect.catch((error) => Effect.succeed(failure('artwork upload')(error))),
    ),
})

export const GenerateMosaic = Command.define('Creator.GenerateMosaic', {
  args: { content: Schema.String },
  messages: [Message.MosaicGenerated, Message.MosaicFailed],
  execute: ({ content }) =>
    Effect.gen(function* () {
      const service = yield* CreatorService
      const file = yield* service.generateMosaic(content)
      const url = yield* service.uploadImage(file)

      return Message.MosaicGenerated({ content, url })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.MosaicFailed({ content, message: error.message })),
      ),
    ),
})

export const UploadAudio = Command.define('Creator.UploadAudio', {
  args: { file: Schema.NullOr(Schema.instanceOf(File)) },
  messages: [
    Message.AudioUploaded,
    Message.UploadPaused,
    Message.UploadFailed,
    Message.UploadUnavailable,
  ],
  execute: ({ file }) =>
    Effect.flatMap(CreatorUpload, (service) => (file ? service.start(file) : service.resume)).pipe(
      Effect.map((url) => Message.AudioUploaded({ url })),
      Effect.catchTag('UploadPaused', ({ checkpoint }) =>
        Effect.succeed(
          Message.UploadPaused({
            percent:
              checkpoint.totalBytes === 0
                ? 0
                : Math.floor(
                    (checkpoint.completedParts.reduce((bytes, part) => bytes + part.size, 0) /
                      checkpoint.totalBytes) *
                      100,
                  ),
          }),
        ),
      ),
      Effect.catchTag('AlreadyInProgressError', () =>
        Effect.succeed(
          Message.UploadUnavailable({
            message: 'The previous upload is pausing. Select your file again in a moment.',
          }),
        ),
      ),
      Effect.catch((error) => Effect.succeed(Message.UploadFailed({ message: error.message }))),
    ),
})

export const PauseUpload = Command.define('Creator.PauseUpload', {
  messages: [Message.UploadPauseAcknowledged],
  execute: Effect.flatMap(CreatorUpload, (service) => service.pause).pipe(
    Effect.as(Message.UploadPauseAcknowledged()),
  ),
})

export const CancelUpload = Command.define('Creator.CancelUpload', {
  messages: [Message.UploadCancelled, Message.UploadFailed],
  execute: Effect.flatMap(CreatorUpload, (service) => service.cancel).pipe(
    Effect.as(Message.UploadCancelled()),
    Effect.catch((error) => Effect.succeed(Message.UploadFailed({ message: error.message }))),
  ),
})
