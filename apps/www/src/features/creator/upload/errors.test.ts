import { describe, expect, test } from 'vitest'

import {
  AlreadyInProgressError,
  FileTooLargeError,
  HttpError,
  InvalidResponseError,
  NetworkError,
  StorageQuotaError,
  UnknownError,
  UploadAborted,
  UploadPaused,
  isFatalError,
  isRetryableError,
} from './errors'
import type { PersistedResumableUpload } from './protocol'

const pausedCheckpoint: PersistedResumableUpload = {
  fileFingerprint: 'fp',
  uploadId: 'u',
  key: 'k',
  chunkSize: 1,
  totalBytes: 0,
  totalParts: 0,
  contentType: 'audio/mpeg',
  fileName: 'f',
  completedParts: [],
  createdAt: 0,
  updatedAt: 0,
}

describe('isRetryableError', () => {
  test('retries only network, timeout, rate-limit, and server failures', () => {
    const retryable = [
      new NetworkError({ message: 'down' }),
      new HttpError({ status: 408, message: 'timeout' }),
      new HttpError({ status: 429, message: 'rate limited' }),
      new HttpError({ status: 500, message: 'server error' }),
      new HttpError({ status: 599, message: 'server error' }),
    ]

    const permanent = [
      new HttpError({ status: 400, message: 'bad request' }),
      new HttpError({ status: 401, message: 'unauthorized' }),
      new UploadAborted(),
      new UploadPaused({ checkpoint: pausedCheckpoint }),
      new InvalidResponseError({ message: 'bad json' }),
      new FileTooLargeError({ maxBytes: 1, actualBytes: 2 }),
      new StorageQuotaError({ message: 'full' }),
      new AlreadyInProgressError({ message: 'busy' }),
      new UnknownError({ message: 'oops' }),
    ]

    for (const error of retryable) expect(isRetryableError(error)).toBe(true)

    for (const error of permanent) expect(isRetryableError(error)).toBe(false)
  })
})

describe('isFatalError', () => {
  test('treats user termination and permanent client responses as fatal', () => {
    const fatal = [
      new UploadAborted(),
      new UploadPaused({ checkpoint: pausedCheckpoint }),
      new HttpError({ status: 401, message: 'unauthorized' }),
      new HttpError({ status: 403, message: 'forbidden' }),
      new HttpError({ status: 413, message: 'too large' }),
      new HttpError({ status: 415, message: 'unsupported type' }),
    ]

    const recoverable = [
      new NetworkError({ message: 'down' }),
      new HttpError({ status: 408, message: 'timeout' }),
      new HttpError({ status: 429, message: 'rate limited' }),
      new HttpError({ status: 500, message: 'server error' }),
    ]

    for (const error of fatal) expect(isFatalError(error)).toBe(true)

    for (const error of recoverable) expect(isFatalError(error)).toBe(false)
  })
})
