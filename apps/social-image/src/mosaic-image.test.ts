import { describe, expect, test } from 'vitest'

import { loadMosaicImage } from './mosaic-image'

describe('mosaic image loading', () => {
  test('checks each redirect before issuing another request', async () => {
    const requests: Array<string> = []

    const result = await loadMosaicImage('https://i.scdn.co/image/a', async (input, init) => {
      expect(init?.redirect).toBe('manual')
      requests.push(input.href)

      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
    })

    expect(result).toBeNull()
    expect(requests).toEqual(['https://i.scdn.co/image/a'])
  })

  test('allows approved redirects and returns image data', async () => {
    const result = await loadMosaicImage('https://coverartarchive.org/a', async (input) =>
      input.hostname === 'coverartarchive.org'
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://archive.org/cover.png' },
          })
        : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    )

    expect(result).toBe('data:image/png;base64,AQID')
  })

  test('rejects SVG, oversized bodies without content-length, and failed requests', async () => {
    expect(
      await loadMosaicImage(
        'https://i.scdn.co/a',
        async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
      ),
    ).toBeNull()
    expect(
      await loadMosaicImage(
        'https://i.scdn.co/a',
        async () =>
          new Response(new Uint8Array(8 * 1024 * 1024 + 1), {
            headers: { 'content-type': 'image/png' },
          }),
      ),
    ).toBeNull()
    expect(
      await loadMosaicImage('https://i.scdn.co/a', async () => {
        throw new Error('offline')
      }),
    ).toBeNull()
  })
})
