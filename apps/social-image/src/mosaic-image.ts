import { mosaicImageUrl } from '@gbfm/rich-content/mosaic'

const MAX_BYTES = 8 * 1024 * 1024

const types = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

type ImageFetcher = (url: URL, init: RequestInit) => Promise<Response>

export const loadMosaicImage = async (
  value: string,
  fetchImage: ImageFetcher = fetch,
  options: { readonly signal?: AbortSignal } = {},
): Promise<string | null> => {
  try {
    let url = mosaicImageUrl(value)

    const signal = AbortSignal.any([
      AbortSignal.timeout(5_000),
      ...(options.signal ? [options.signal] : []),
    ])

    for (let hop = 0; url && hop < 4; hop++) {
      const response = await fetchImage(url, { redirect: 'manual', signal })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        url = location ? mosaicImageUrl(new URL(location, url).href) : null
        continue
      }

      const type = response.headers.get('content-type')?.split(';')[0]?.trim()

      if (
        !response.ok ||
        !type ||
        !types.has(type) ||
        Number(response.headers.get('content-length')) > MAX_BYTES
      ) {
        await response.body?.cancel()

        return null
      }

      const reader = response.body?.getReader()

      if (!reader) return null
      const chunks: Array<Uint8Array> = []
      let length = 0

      try {
        while (true) {
          const chunk = await reader.read()

          if (chunk.done) break
          length += chunk.value.length

          if (length > MAX_BYTES) return null
          chunks.push(chunk.value)
        }
      } finally {
        await reader.cancel()
      }

      if (!length) return null
      let binary = ''

      for (const chunk of chunks)
        for (let offset = 0; offset < chunk.length; offset += 0x8000) {
          binary += String.fromCharCode(...chunk.subarray(offset, offset + 0x8000))
        }

      return `data:${type};base64,${btoa(binary)}`
    }

    return null
  } catch {
    return null
  }
}
