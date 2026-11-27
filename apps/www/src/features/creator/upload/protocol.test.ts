import { describe, expect, test } from 'vitest'

import {
  computeBackoff,
  computeFileFingerprint,
  createPersistedUpload,
  isRetryableStatus,
  mergeCompletedParts,
  missingPartNumbers,
  parseAbortResponse,
  parseCompleteResponse,
  parseInitResponse,
  parsePersistedUpload,
  parsePresignPartResponse,
  parseStatusResponse,
  splitFileIntoChunks,
  totalParts,
  withUpdatedPart,
} from './protocol'

const makeFile = (size: number, name = 'mix.mp3', lastModified = 1_700_000_000_000): File => {
  const blob = new Blob([new Uint8Array(size)], { type: 'audio/mpeg' })

  return new File([blob], name, { type: 'audio/mpeg', lastModified })
}

describe('resumable upload contracts', () => {
  test('creates a stable file identity from size, name, and modification time', () => {
    const first = makeFile(100, 'a.mp3', 1)

    const files = [
      first,
      makeFile(100, 'b.mp3', 1),
      makeFile(100, 'a.mp3', 2),
      makeFile(101, 'a.mp3', 1),
    ]

    expect(computeFileFingerprint(first)).toBe('100:a.mp3:1')
    expect(new Set(files.map(computeFileFingerprint)).size).toBe(4)
  })

  test('plans numbered chunks for exact, partial, small, and empty files', () => {
    const summarize = (file: File, chunkSize: number) =>
      splitFileIntoChunks(file, chunkSize).map(({ partNumber, start, end, blob }) => ({
        partNumber,
        start,
        end,
        size: blob.size,
      }))

    expect(summarize(makeFile(100), 25)).toEqual([
      { partNumber: 1, start: 0, end: 25, size: 25 },
      { partNumber: 2, start: 25, end: 50, size: 25 },
      { partNumber: 3, start: 50, end: 75, size: 25 },
      { partNumber: 4, start: 75, end: 100, size: 25 },
    ])
    expect(summarize(makeFile(105), 100)).toEqual([
      { partNumber: 1, start: 0, end: 100, size: 100 },
      { partNumber: 2, start: 100, end: 105, size: 5 },
    ])
    expect(summarize(makeFile(5), 10)).toEqual([{ partNumber: 1, start: 0, end: 5, size: 5 }])
    expect(summarize(makeFile(0), 10)).toEqual([])
    expect(totalParts(100, 10)).toBe(10)
    expect(totalParts(101, 10)).toBe(11)
    expect(totalParts(0, 10)).toBe(0)
    expect(() => splitFileIntoChunks(makeFile(10), 0)).toThrow('chunkSize must be positive')
    expect(() => totalParts(10, 0)).toThrow('chunkSize must be positive')
  })

  test('reconciles completed parts by number, preferring newer data and sorting the result', () => {
    expect(
      mergeCompletedParts(
        [
          { partNumber: 3, etag: 'c', size: 30 },
          { partNumber: 1, etag: 'old', size: 10 },
        ],
        [
          { partNumber: 2, etag: 'b', size: 20 },
          { partNumber: 1, etag: 'new', size: 12 },
        ],
      ),
    ).toEqual([
      { partNumber: 1, etag: 'new', size: 12 },
      { partNumber: 2, etag: 'b', size: 20 },
      { partNumber: 3, etag: 'c', size: 30 },
    ])
  })

  test('builds and advances a resumable checkpoint through completion', () => {
    const file = makeFile(150)

    const initial = createPersistedUpload({
      file,
      fileFingerprint: computeFileFingerprint(file),
      init: { uploadId: 'upload-1', key: 'audio/mix.mp3', chunkSize: 50 },
      now: 1_000,
    })

    expect(initial).toEqual({
      fileFingerprint: '150:mix.mp3:1700000000000',
      uploadId: 'upload-1',
      key: 'audio/mix.mp3',
      chunkSize: 50,
      totalBytes: 150,
      totalParts: 3,
      contentType: 'audio/mpeg',
      fileName: 'mix.mp3',
      completedParts: [],
      createdAt: 1_000,
      updatedAt: 1_000,
    })

    const part2 = withUpdatedPart(initial, { partNumber: 2, etag: 'etag-2', size: 50 }, 2_000)
    expect(missingPartNumbers(part2.totalParts, part2.completedParts)).toEqual([1, 3])

    const part1 = withUpdatedPart(part2, { partNumber: 1, etag: 'old', size: 50 }, 3_000)
    const replacedPart1 = withUpdatedPart(part1, { partNumber: 1, etag: 'etag-1', size: 50 }, 4_000)

    const completed = withUpdatedPart(
      replacedPart1,
      { partNumber: 3, etag: 'etag-3', size: 50 },
      5_000,
    )

    expect(completed.completedParts).toEqual([
      { partNumber: 1, etag: 'etag-1', size: 50 },
      { partNumber: 2, etag: 'etag-2', size: 50 },
      { partNumber: 3, etag: 'etag-3', size: 50 },
    ])
    expect(completed.updatedAt).toBe(5_000)
    expect(missingPartNumbers(completed.totalParts, completed.completedParts)).toEqual([])
  })

  test('applies exponential backoff with deterministic jitter and a maximum delay', () => {
    expect(computeBackoff(1, 1_000, 60_000, () => 0)).toBe(1_000)
    expect(computeBackoff(2, 1_000, 60_000, () => 0.5)).toBe(2_500)
    expect(computeBackoff(20, 1_000, 5_000, () => 1)).toBe(5_000)
  })

  test('retries timeouts, rate limits, and server failures but not other statuses', () => {
    const cases: ReadonlyArray<readonly [number, boolean]> = [
      [200, false],
      [301, false],
      [400, false],
      [408, true],
      [429, true],
      [500, true],
      [599, true],
      [600, false],
    ]

    for (const [status, retryable] of cases) {
      expect(isRetryableStatus(status)).toBe(retryable)
    }
  })

  test('decodes every multipart API response used by the upload workflow', () => {
    expect(parseInitResponse({ uploadId: 'u', key: 'k', chunkSize: 10 })).toEqual({
      uploadId: 'u',
      key: 'k',
      chunkSize: 10,
    })
    expect(
      parsePresignPartResponse({
        url: 'https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc',
        partNumber: 1,
        expiresInSeconds: 300,
      }),
    ).toEqual({
      url: 'https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc',
      partNumber: 1,
      expiresInSeconds: 300,
    })
    const status = parseStatusResponse({ parts: [{ partNumber: 1, etag: 'e', size: 10 }] })
    expect(status).toEqual({
      parts: [{ partNumber: 1, etag: 'e', size: 10 }],
    })
    expect(() => status.parts.push({ partNumber: 2, etag: 'next', size: 20 })).not.toThrow()
    expect(parseAbortResponse({ ok: true })).toEqual({ ok: true })
    expect(parseCompleteResponse({ url: 'https://cdn.example/mix.mp3', key: 'k' })).toEqual({
      url: 'https://cdn.example/mix.mp3',
      key: 'k',
    })
  })

  test('rejects malformed API responses and ignores corrupt persisted checkpoints', () => {
    expect(() => parseInitResponse({ uploadId: 'u', key: 'k' })).toThrow()
    expect(() => parsePresignPartResponse({ partNumber: 1 })).toThrow()
    expect(() => parseStatusResponse({ parts: 'nope' })).toThrow()
    expect(() => parseAbortResponse({ ok: false })).toThrow()
    expect(parsePersistedUpload({ nope: true })).toBeNull()

    const checkpoint = {
      fileFingerprint: '1:a.mp3:1',
      uploadId: 'u',
      key: 'k',
      chunkSize: 10,
      totalBytes: 100,
      totalParts: 10,
      contentType: 'audio/mpeg',
      fileName: 'a.mp3',
      completedParts: [{ partNumber: 1, etag: 'e', size: 10 }],
      createdAt: 0,
      updatedAt: 0,
    }

    const restored = parsePersistedUpload(checkpoint)
    expect(restored).toEqual(checkpoint)
    expect(() =>
      restored?.completedParts.push({ partNumber: 2, etag: 'next', size: 20 }),
    ).not.toThrow()
  })
})
