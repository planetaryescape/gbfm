import { describe, expect, test } from 'vitest'

import { canonicalQuery, presignedUrl, type R2SigningConfig } from './r2-signing'

const config: R2SigningConfig = {
  accountId: 'test-account',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  bucketName: 'test-bucket',
}

const now = new Date('2026-06-16T22:27:59.000Z')

describe('R2 SigV4 signing', () => {
  test('signs create-only artwork integrity headers and changes the signature when they change', async () => {
    const headers = {
      'content-type': 'image/png',
      'content-length': '68',
      'content-md5': 'AAAAAAAAAAAAAAAAAAAAAA==',
      'if-none-match': '*',
      'x-amz-meta-artwork-receipt': 'fixture-receipt',
    }

    const input = {
      config,
      method: 'PUT',
      key: 'private/owner/image/fixture.png',
      query: [],
      expiresSeconds: 300,
      now,
      headers,
    }

    const original = new URL(await presignedUrl(input))
    expect(original.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-md5;content-type;host;if-none-match;x-amz-meta-artwork-receipt',
    )

    for (const name of Object.keys(headers)) {
      const changed = new URL(
        await presignedUrl({ ...input, headers: { ...headers, [name]: 'changed' } }),
      )

      expect(changed.searchParams.get('X-Amz-Signature')).not.toBe(
        original.searchParams.get('X-Amz-Signature'),
      )
    }
  })
  test('sorts encoded query parameters by byte order', () => {
    expect(
      canonicalQuery([
        ['partNumber', '1'],
        ['uploadId', 'a+b/c'],
        ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ]),
    ).toBe('X-Amz-Algorithm=AWS4-HMAC-SHA256&partNumber=1&uploadId=a%2Bb%2Fc')
  })

  test('produces deterministic multipart upload URLs', async () => {
    const query: Array<[string, string]> = [
      ['partNumber', '1'],
      ['uploadId', 'upload-1'],
    ]

    const input = {
      config,
      method: 'PUT',
      key: 'user-1/multipart/clip.mp3',
      query,
      expiresSeconds: 900,
      now,
    }

    const first = await presignedUrl(input)
    const second = await presignedUrl(input)
    const url = new URL(first)

    expect(first).toBe(second)
    expect(url.hostname).toBe('test-account.r2.cloudflarestorage.com')
    expect([...url.searchParams.keys()]).toEqual([
      'X-Amz-Algorithm',
      'X-Amz-Credential',
      'X-Amz-Date',
      'X-Amz-Expires',
      'X-Amz-SignedHeaders',
      'partNumber',
      'uploadId',
      'X-Amz-Signature',
    ])
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })
})
