import { Schema } from 'effect'

export type ResumableUploadPhase =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'paused'
  | 'finalizing'
  | 'completed'
  | 'aborted'
  | 'error'

export interface ResumableUploadResult {
  url: string
  key: string
}

export interface ResumablePart {
  partNumber: number
  etag: string
  size: number
}

export interface PersistedResumableUpload {
  fileFingerprint: string
  uploadId: string
  key: string
  chunkSize: number
  totalBytes: number
  totalParts: number
  contentType: string
  fileName: string
  completedParts: Array<ResumablePart>
  createdAt: number
  updatedAt: number
}

export interface MultipartInitResponse {
  uploadId: string
  key: string
  chunkSize: number
}

export interface PresignPartResponse {
  url: string
  partNumber: number
  expiresInSeconds: number
}

export interface MultipartStatusResponse {
  parts: Array<ResumablePart>
}

export interface MultipartAbortResponse {
  ok: true
}

const multipartInitResponseSchema = Schema.Struct({
  uploadId: Schema.String,
  key: Schema.String,
  chunkSize: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
})

const presignPartResponseSchema = Schema.Struct({
  url: Schema.String,
  partNumber: Schema.Number,
  expiresInSeconds: Schema.Number,
})

const multipartStatusResponseSchema = Schema.Struct({
  parts: Schema.Array(
    Schema.Struct({
      partNumber: Schema.Number,
      etag: Schema.String,
      size: Schema.Number,
    }),
  ),
})

const multipartAbortResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
})

const multipartCompleteResponseSchema = Schema.Struct({
  url: Schema.String,
  key: Schema.String,
})

const persistedUploadSchema = Schema.Struct({
  fileFingerprint: Schema.String,
  uploadId: Schema.String,
  key: Schema.String,
  chunkSize: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
  totalBytes: Schema.Number,
  totalParts: Schema.Number,
  contentType: Schema.String,
  fileName: Schema.String,
  completedParts: Schema.Array(
    Schema.Struct({
      partNumber: Schema.Number,
      etag: Schema.String,
      size: Schema.Number,
    }),
  ),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export type JsonInput =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonInput>
  | { readonly [key: string]: JsonInput }

export const parseInitResponse = (raw: JsonInput): MultipartInitResponse =>
  Schema.decodeUnknownSync(multipartInitResponseSchema)(raw)

export const parsePresignPartResponse = (raw: JsonInput): PresignPartResponse =>
  Schema.decodeUnknownSync(presignPartResponseSchema)(raw)

export const parseStatusResponse = (raw: JsonInput): MultipartStatusResponse => {
  const decoded = Schema.decodeUnknownSync(multipartStatusResponseSchema)(raw)

  return {
    parts: decoded.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag, size: p.size })),
  }
}

export const parseAbortResponse = (raw: JsonInput): MultipartAbortResponse =>
  Schema.decodeUnknownSync(multipartAbortResponseSchema)(raw)

export const parseCompleteResponse = (raw: JsonInput): { url: string; key: string } =>
  Schema.decodeUnknownSync(multipartCompleteResponseSchema)(raw)

export const parsePersistedUpload = (raw: JsonInput): PersistedResumableUpload | null => {
  try {
    const decoded = Schema.decodeUnknownSync(persistedUploadSchema)(raw)

    return {
      ...decoded,
      completedParts: decoded.completedParts.map((p) => ({
        partNumber: p.partNumber,
        etag: p.etag,
        size: p.size,
      })),
    }
  } catch {
    return null
  }
}

export const computeFileFingerprint = (file: File): string =>
  `${file.size}:${file.name}:${file.lastModified}`

export const splitFileIntoChunks = (
  file: File,
  chunkSize: number,
): Array<{ partNumber: number; blob: Blob; start: number; end: number }> => {
  if (chunkSize <= 0) {
    throw new Error('chunkSize must be positive')
  }

  const chunks: Array<{ partNumber: number; blob: Blob; start: number; end: number }> = []
  let offset = 0
  let partNumber = 1

  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size)
    chunks.push({
      partNumber,
      blob: file.slice(offset, end),
      start: offset,
      end,
    })
    offset = end
    partNumber += 1
  }

  return chunks
}

export const totalParts = (fileSize: number, chunkSize: number): number => {
  if (chunkSize <= 0) {
    throw new Error('chunkSize must be positive')
  }

  if (fileSize === 0) return 0

  return Math.ceil(fileSize / chunkSize)
}

export const mergeCompletedParts = (
  ...sources: ReadonlyArray<Array<ResumablePart>>
): Array<ResumablePart> => {
  const byPartNumber = new Map<number, ResumablePart>()

  for (const source of sources) {
    for (const part of source) {
      byPartNumber.set(part.partNumber, part)
    }
  }

  return Array.from(byPartNumber.values()).toSorted((a, b) => a.partNumber - b.partNumber)
}

export const missingPartNumbers = (
  totalParts: number,
  completed: ReadonlyArray<ResumablePart>,
): Array<number> => {
  const have = new Set(completed.map((p) => p.partNumber))
  const missing: Array<number> = []

  for (let i = 1; i <= totalParts; i += 1) {
    if (!have.has(i)) missing.push(i)
  }

  return missing
}

export const computeBackoff = (
  attempt: number,
  baseMs = 1000,
  maxMs = 30000,
  random: () => number = Math.random,
): number => {
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1)
  const jitter = random() * baseMs

  return Math.min(exponential + jitter, maxMs)
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))

      return
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })

export const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || (status >= 500 && status < 600)

export const createPersistedUpload = (input: {
  file: File
  fileFingerprint: string
  init: MultipartInitResponse
  now?: number
}): PersistedResumableUpload => {
  const now = input.now ?? Date.now()

  return {
    fileFingerprint: input.fileFingerprint,
    uploadId: input.init.uploadId,
    key: input.init.key,
    chunkSize: input.init.chunkSize,
    totalBytes: input.file.size,
    totalParts: totalParts(input.file.size, input.init.chunkSize),
    contentType: input.file.type,
    fileName: input.file.name,
    completedParts: [],
    createdAt: now,
    updatedAt: now,
  }
}

export const withUpdatedPart = (
  persisted: PersistedResumableUpload,
  part: ResumablePart,
  now?: number,
): PersistedResumableUpload => {
  const existingIndex = persisted.completedParts.findIndex((p) => p.partNumber === part.partNumber)

  const completedParts =
    existingIndex === -1
      ? [...persisted.completedParts, part]
      : persisted.completedParts.map((p, i) => (i === existingIndex ? part : p))

  return {
    ...persisted,
    completedParts: completedParts.toSorted((a, b) => a.partNumber - b.partNumber),
    updatedAt: now ?? Date.now(),
  }
}
