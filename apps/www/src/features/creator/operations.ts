import { Command } from '@effect/ui'
import { Effect, Match, Schema } from 'effect'

import { Kind, SavedContent, tweetSlug } from './domain'
import {
  CreatorLegacyRecovery,
  LegacyRecoveryPrincipal,
  LegacyRecoveryToken,
} from './legacy-recovery'
import { CreatorDraftSchema, CreatorRequestError, CreatorService } from './services'
import { CreatorPageMessage as M, SelectedFile } from './state'
import type { ResumableUploadError } from './upload/errors'
import { CreatorUpload } from './upload/runtime'

const uploadFailure = (error: ResumableUploadError) =>
  M.FailedUploadAudio(
    Match.value(error).pipe(
      Match.tag('UploadPaused', ({ checkpoint }) => ({
        message: 'Upload paused.',
        paused: true,
        checkpointPercent: Math.floor(
          (checkpoint.completedParts.reduce((total, part) => total + part.size, 0) /
            checkpoint.totalBytes) *
            100,
        ),
      })),
      Match.tag('UploadAborted', () => ({ message: 'Upload cancelled.', paused: false })),
      Match.tag('FileTooLargeError', ({ maxBytes }) => ({
        message: `Audio files must not exceed ${Math.round(maxBytes / (1024 * 1024))} MB.`,
        paused: false,
      })),
      Match.tag('AlreadyInProgressError', () => ({
        message: 'Pause the current upload before starting or cancelling another.',
        paused: false,
      })),
      Match.tag('HttpError', ({ status }) => ({
        message: `The upload service returned HTTP ${status}. Retry or reselect the original audio file.`,
        paused: false,
      })),
      Match.tag('StorageQuotaError', () => ({
        message: 'The upload checkpoint could not be saved on this device.',
        paused: false,
      })),
      Match.tag('InvalidResponseError', ({ message }) => ({
        message:
          message === 'init: invalid response'
            ? message
            : 'The upload service returned an invalid response. Retry or reselect the original audio file.',
        paused: false,
      })),
      Match.orElse(() => ({
        message: 'The upload could not finish. Retry or reselect the original audio file.',
        paused: false,
      })),
    ),
  )

export class ReadDraft extends Command.Service<ReadDraft>()('creator/ReadDraft', {
  args: { key: Schema.String, revision: Schema.Number },
  success: M,
  mode: 'switch',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* CreatorService

      return ({ key, revision }) =>
        service.readLocalDraft(key).pipe(
          Effect.match({
            onSuccess: (draft) => M.CompletedReadDraft({ key, draft, revision }),
            onFailure: (e) => M.FailedReadDraft({ key, revision, message: e.message }),
          }),
        )
    }),
  )
}

export class ReadLegacyRecovery extends Command.Service<ReadLegacyRecovery>()(
  'creator/ReadLegacyRecovery',
  {
    args: { key: Schema.String, revision: Schema.Number, principal: LegacyRecoveryPrincipal },
    success: M,
    mode: 'switch',
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const recovery = yield* CreatorLegacyRecovery

      return ({ key, revision, principal }) =>
        recovery.read(key, principal).pipe(
          Effect.match({
            onSuccess: (candidate) => M.CompletedReadLegacyRecovery({ key, revision, candidate }),
            onFailure: (e) => M.FailedLegacyRecovery({ key, revision, message: e.message }),
          }),
        )
    }),
  )
}

export class ResolveLegacyRecovery extends Command.Service<ResolveLegacyRecovery>()(
  'creator/ResolveLegacyRecovery',
  {
    args: {
      key: Schema.String,
      revision: Schema.Number,
      principal: LegacyRecoveryPrincipal,
      token: LegacyRecoveryToken,
      action: Schema.Literals(['restore', 'dismiss']),
    },
    success: M,
    mode: 'queue',
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const recovery = yield* CreatorLegacyRecovery

      return ({ key, revision, principal, token, action }) =>
        recovery.resolve(key, principal, token, action).pipe(
          Effect.match({
            onSuccess: (draft) => M.CompletedResolveLegacyRecovery({ key, revision, token, draft }),
            onFailure: (e) => M.FailedLegacyRecovery({ key, revision, message: e.message }),
          }),
        )
    }),
  )
}

export class WriteDraft extends Command.Service<WriteDraft>()('creator/WriteDraft', {
  args: { key: Schema.String, draft: CreatorDraftSchema, revision: Schema.Number },
  success: M,
  mode: 'queue',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* CreatorService

      return ({ key, draft, revision }) =>
        service.writeLocalDraft(key, draft).pipe(
          Effect.match({
            onSuccess: () => M.CompletedWriteDraft({ key, revision }),
            onFailure: (e) => M.FailedWriteDraft({ key, revision, message: e.message }),
          }),
        )
    }),
  )
}

export class SaveContent extends Command.Service<SaveContent>()('creator/SaveContent', {
  args: {
    draft: CreatorDraftSchema,
    creatorId: Schema.String,
    revision: Schema.Number,
    operation: Schema.Number,
    publish: Schema.Boolean,
  },
  success: M,
  mode: 'queue',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* CreatorService

      return ({ draft, creatorId, revision, operation, publish }) =>
        service.save({ draft, creatorId, publish }).pipe(
          Effect.match({
            onSuccess: (saved) =>
              M.SucceededSaveContent({ saved, draft, revision, operation, publish }),
            onFailure: (e) => M.FailedOperation({ operation, message: e.message }),
          }),
        )
    }),
  )
}

export class ReconcileDraft extends Command.Service<ReconcileDraft>()('creator/ReconcileDraft', {
  args: {
    key: Schema.String,
    saved: CreatorDraftSchema,
    remote: SavedContent,
    retained: Schema.NullOr(CreatorDraftSchema),
    operation: Schema.Number,
  },
  success: M,
  mode: 'queue',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* CreatorService

      return ({ key, saved, remote, retained, operation }) =>
        service.reconcileLocalDraft(key, saved, remote, retained).pipe(
          Effect.match({
            onSuccess: () => M.CompletedReconcileDraft({ operation }),
            onFailure: (e) => M.FailedReconcileDraft({ operation, message: e.message }),
          }),
        )
    }),
  )
}

export class ResolveMusic extends Command.Service<ResolveMusic>()('creator/ResolveMusic', {
  args: { url: Schema.String, kind: Kind, revision: Schema.Number },
  success: M,
  mode: 'switch',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* CreatorService

      return ({ url, kind, revision }) =>
        service.resolveMusic(url, kind).pipe(
          Effect.match({
            onSuccess: (music) =>
              M.SucceededResolveMusic({
                revision,
                entityType: music.entityType,
                entityId: music.entityId,
                title: music.title,
                image: music.coverImageUrl,
              }),
            onFailure: (e) => M.FailedResolveMusic({ revision, message: e.message }),
          }),
        )
    }),
  )
}

export class ResolveQuote extends Command.Service<ResolveQuote>()('creator/ResolveQuote', {
  args: { url: Schema.String, revision: Schema.Number },
  success: M,
  mode: 'switch',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* CreatorService

      return ({ url, revision }) =>
        Effect.try({
          try: () => new URL(url, 'https://gbfm.local'),
          catch: () =>
            new CreatorRequestError({
              operation: 'resolve quote',
              status: 400,
              message: 'Enter a valid tweet URL or slug.',
            }),
        }).pipe(
          Effect.flatMap((parsed) =>
            service.resolveQuote(
              parsed.pathname.split('/').findLast((segment) => segment.length > 0) ?? '',
            ),
          ),
          Effect.flatMap((quote) =>
            quote.slug === tweetSlug(url)
              ? Effect.succeed(quote)
              : Effect.fail(
                  new CreatorRequestError({
                    operation: 'resolve quote',
                    status: 422,
                    message: 'The quoted tweet did not match the requested URL.',
                  }),
                ),
          ),
          Effect.match({
            onSuccess: (quote) =>
              M.SucceededResolveQuote({
                revision,
                id: quote.id,
                title: quote.title ?? quote.content ?? quote.slug,
              }),
            onFailure: (e) => M.FailedResolveQuote({ revision, message: e.message }),
          }),
        )
    }),
  )
}

export class ResolvePostMusic extends Command.Service<ResolvePostMusic>()(
  'creator/ResolvePostMusic',
  {
    args: {
      postId: Schema.String,
      url: Schema.String,
      expectedUpdatedAt: Schema.optional(Schema.String),
      operation: Schema.Number,
    },
    success: M,
    mode: 'queue',
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* CreatorService

      return ({ postId, url, expectedUpdatedAt, operation }) =>
        service.resolvePostMusic(postId, url, expectedUpdatedAt).pipe(
          Effect.match({
            onSuccess: (music) =>
              M.SucceededResolvePostMusic({
                operation,
                postId,
                updatedAt: music.updatedAt,
                entityType: music.entityType,
                entityId: music.entityId,
                title: music.title,
                image: music.coverImageUrl,
              }),
            onFailure: (e) => M.FailedOperation({ operation, message: e.message }),
          }),
        )
    }),
  )
}

export class UploadArtwork extends Command.Service<UploadArtwork>()('creator/UploadArtwork', {
  args: { file: SelectedFile, kind: Kind, revision: Schema.Number, previousUrl: Schema.String },
  success: M,
  mode: 'switch',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* CreatorService

      return ({ file, kind, revision, previousUrl }) =>
        service.uploadImage(file).pipe(
          Effect.match({
            onSuccess: (url) => M.SucceededUploadArtwork({ kind, revision, previousUrl, url }),
            onFailure: (e) =>
              M.FailedUploadArtwork({ kind, revision, message: `artwork upload: ${e.message}` }),
          }),
        )
    }),
  )
}

export class GenerateMosaic extends Command.Service<GenerateMosaic>()('creator/GenerateMosaic', {
  args: { content: Schema.String, operation: Schema.Number },
  success: M,
  mode: 'switch',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* CreatorService

      return ({ content, operation }) =>
        service.generateMosaic(content).pipe(
          Effect.flatMap(service.uploadImage),
          Effect.match({
            onSuccess: (url) => M.SucceededGenerateMosaic({ operation, content, url }),
            onFailure: (e) => M.FailedGenerateMosaic({ operation, content, message: e.message }),
          }),
        )
    }),
  )
}

export class UploadAudio extends Command.Service<UploadAudio>()('creator/UploadAudio', {
  args: { file: Schema.optional(SelectedFile) },
  success: M,
  mode: 'queue',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const upload = yield* CreatorUpload

      return ({ file }) =>
        (file ? upload.start(file) : upload.resume).pipe(
          Effect.match({
            onSuccess: (url) => M.SucceededUploadAudio({ url }),
            onFailure: uploadFailure,
          }),
        )
    }),
  )
}

export class PauseUpload extends Command.Service<PauseUpload>()('creator/PauseUpload', {
  args: {},
  success: M,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const upload = yield* CreatorUpload

      return () => upload.pause.pipe(Effect.as(M.CompletedPauseUpload()))
    }),
  )
}

export class CancelUpload extends Command.Service<CancelUpload>()('creator/CancelUpload', {
  args: {},
  success: M,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const upload = yield* CreatorUpload

      return () =>
        upload.cancel.pipe(
          Effect.match({
            onSuccess: () => M.CompletedCancelUpload(),
            onFailure: uploadFailure,
          }),
        )
    }),
  )
}
