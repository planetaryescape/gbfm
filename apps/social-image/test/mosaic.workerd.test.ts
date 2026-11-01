import { Resvg } from '@resvg/resvg-wasm'
import type { Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import resvgWasm from '../assets/resvg.wasm'
import yogaWasm from '../assets/yoga.wasm'
import { renderMosaic } from '../src/mosaic'
import { handleMosaic } from '../src/mosaic-handler'
import { initializeRuntime, type SocialCardRenderAssets } from '../src/render-runtime'

const assets: SocialCardRenderAssets = {
  loadWasm: async (name) => (name === 'yoga.wasm' ? yogaWasm : resvgWasm),
  loadFont: async () => new ArrayBuffer(0),
  loadImage: async () => null,
}

const candidate = (index: number) => ({
  identity: `album:${index}`,
  url: `https://i.scdn.co/image/${index}`,
})

describe('mosaic rendering in workerd', () => {
  test.each([1, 2, 3, 4])(
    'renders %i images to a deterministic 1200px PNG with a versioned recipe',
    async (count) => {
      await initializeRuntime(assets)
      const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00']

      const fixtures = colors.map((color) => {
        const renderer = new Resvg(
          `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${color}"/></svg>`,
        )

        try {
          return `data:image/png;base64,${btoa(String.fromCharCode(...renderer.render().asPng()))}`
        } finally {
          renderer.free()
        }
      })

      const candidates = Array.from({ length: count }, (_, i) => candidate(i))

      const loader = {
        ...assets,
        loadImage: async (url: string) => fixtures[Number(url.split('/').at(-1))] ?? null,
      }

      const first = await renderMosaic(candidates, loader)
      const second = await renderMosaic(candidates, loader)
      expect(first?.png).toEqual(second?.png)
      expect(first?.recipe.images).toHaveLength(count)

      if (!first) throw new Error('Expected a rendered mosaic')
      expect(first.png.subarray(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
      const header = new DataView(first.png.buffer, first.png.byteOffset, first.png.byteLength)
      expect(header.getUint32(16)).toBe(1200)
      expect(header.getUint32(20)).toBe(1200)
      expect(first.revision).toMatch(/^[a-f0-9]{16}$/)
    },
  )

  test('rejects invalid inputs and reports no usable artwork rather than emitting an empty image', async () => {
    const request = (body: Schema.Json) =>
      new Request('https://social.internal/internal/mosaic', {
        method: 'POST',
        body: JSON.stringify(body),
      })

    expect((await handleMosaic(request({ candidates: [] }), assets)).status).toBe(400)
    expect((await handleMosaic(request({ candidates: [candidate(0)] }), assets)).status).toBe(422)
    expect(
      (
        await handleMosaic(
          request({ candidates: Array.from({ length: 17 }, (_, i) => candidate(i)) }),
          assets,
        )
      ).status,
    ).toBe(400)
  })
})
