import { Data, Match } from 'effect'

import type { PersistedResumableUpload } from './protocol'

export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class HttpError extends Data.TaggedError('HttpError')<{
  readonly status: number
  readonly message: string
  readonly partNumber?: number
}> {}

export class InvalidResponseError extends Data.TaggedError('InvalidResponseError')<{
  readonly message: string
}> {}

export class UploadAborted extends Data.TaggedError('UploadAborted') {
  override readonly message = 'Upload cancelled.'
}

export class UploadPaused extends Data.TaggedError('UploadPaused')<{
  readonly checkpoint: PersistedResumableUpload
}> {
  override readonly message = 'Upload paused.'
}

export class AlreadyInProgressError extends Data.TaggedError('AlreadyInProgressError')<{
  readonly message: string
}> {}

export class FileTooLargeError extends Data.TaggedError('FileTooLargeError')<{
  readonly maxBytes: number
  readonly actualBytes: number
}> {}

export class StorageQuotaError extends Data.TaggedError('StorageQuotaError')<{
  readonly message: string
}> {}

export class UnknownError extends Data.TaggedError('UnknownError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

export type ResumableUploadError =
  | NetworkError
  | HttpError
  | InvalidResponseError
  | UploadAborted
  | UploadPaused
  | AlreadyInProgressError
  | FileTooLargeError
  | StorageQuotaError
  | UnknownError

export const isRetryableError = Match.type<ResumableUploadError>().pipe(
  Match.tag('NetworkError', () => true),
  Match.tag(
    'HttpError',
    ({ status }) => status === 408 || status === 429 || (status >= 500 && status < 600),
  ),
  Match.orElse(() => false),
)

export const isFatalError = Match.type<ResumableUploadError>().pipe(
  Match.tags({ UploadAborted: () => true, UploadPaused: () => true }),
  Match.tag(
    'HttpError',
    ({ status }) => status !== 408 && status !== 429 && status >= 400 && status < 500,
  ),
  Match.orElse(() => false),
)
