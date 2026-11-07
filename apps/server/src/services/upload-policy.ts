// Authoritative upload limits and ownership/completion rules shared by adapters.
// No upload_assets lifecycle row is proof of permission or completed bytes.
export const CHUNK_SIZE = 8 * 1024 * 1024

export const MAX_AUDIO_SIZE = 200 * 1024 * 1024

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024

// An 8 MiB part can need longer than an image on a slow connection.
export const PRESIGNED_PART_URL_EXPIRY_SECONDS = 15 * 60

export const PRESIGNED_IMAGE_URL_EXPIRY_SECONDS = 5 * 60

// Informational lifecycle retention is deliberately longer than PUT authority.
export const PENDING_ASSET_EXPIRY_SECONDS = 30 * 24 * 60 * 60

export const sanitizeKeySegment = (value: string): string => value.replace(/[^a-zA-Z0-9.-]/g, '_')

export const buildObjectKey = (
  userId: string,
  fileType: string,
  fileName: string,
  expectedSize: number,
  attemptId: string,
): string =>
  `private/${sanitizeKeySegment(userId)}/multipart/${attemptId}/${expectedSize}/${fileType}_${sanitizeKeySegment(fileName)}`

export const buildImageObjectKey = (userId: string, fileName: string, attemptId: string): string =>
  `private/${sanitizeKeySegment(userId)}/image/${attemptId}/${sanitizeKeySegment(fileName)}`

export const ownsUploadKey = (userId: string, key: string) =>
  key.startsWith(`${sanitizeKeySegment(userId)}/`) ||
  key.startsWith(`private/${sanitizeKeySegment(userId)}/`)

export const hasContiguousUploadParts = (parts: ReadonlyArray<{ partNumber: number }>) =>
  parts
    .toSorted((a, b) => a.partNumber - b.partNumber)
    .every((part, index) => part.partNumber === index + 1)

export const expectedMultipartPartSize = (expectedSize: number, partNumber: number) => {
  const partCount = Math.ceil(expectedSize / CHUNK_SIZE)

  if (partNumber < 1 || partNumber > partCount) return null

  if (partNumber < partCount) return CHUNK_SIZE

  return expectedSize - CHUNK_SIZE * (partCount - 1)
}

export const hasValidMultipartParts = (
  expectedSize: number,
  parts: ReadonlyArray<{ partNumber: number; size: number }>,
) =>
  parts.length === Math.ceil(expectedSize / CHUNK_SIZE) &&
  hasContiguousUploadParts(parts) &&
  parts.every((part) => part.size === expectedMultipartPartSize(expectedSize, part.partNumber))

export const matchesCompletedObject = (
  expectedSize: number,
  object: { readonly size: number; readonly metadata: Readonly<Record<string, string>> } | null,
) => object?.size === expectedSize && object.metadata['expected-size'] === String(expectedSize)

export const expectedSizeFromKey = (userId: string, key: string) => {
  const prefix = `${key.startsWith('private/') ? 'private/' : ''}${sanitizeKeySegment(userId)}/multipart/`

  if (!key.startsWith(prefix)) return null
  const segments = key.slice(prefix.length).split('/')

  if (segments.length !== 3 || !/^[0-9a-f-]{36}$/i.test(segments[0] ?? '')) return null
  const expectedSize = Number(segments[1])

  return Number.isSafeInteger(expectedSize) && expectedSize > 0 && expectedSize <= MAX_AUDIO_SIZE
    ? expectedSize
    : null
}
