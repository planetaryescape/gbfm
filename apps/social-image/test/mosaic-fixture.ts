import { Resvg } from '@resvg/resvg-wasm'

import { renderMosaic } from '../src/mosaic'
import { initializeRuntime, type SocialCardRenderAssets } from '../src/render-runtime'

export const renderMosaicFixture = async (assets: SocialCardRenderAssets) => {
  await initializeRuntime(assets)
  const colors = ['#d9ef79', '#e8a5bb', '#869bbd', '#e29a61']

  const sources = colors.map((color, i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="${color}"/><circle cx="${80 + i * 40}" cy="150" r="95" fill="#232323"/><circle cx="${80 + i * 40}" cy="150" r="40" fill="${color}"/><path d="M0 250L300 40" stroke="#faf7ef" stroke-width="14"/></svg>`
    const renderer = new Resvg(svg)

    try {
      return `data:image/png;base64,${btoa(String.fromCharCode(...renderer.render().asPng()))}`
    } finally {
      renderer.free()
    }
  })

  return renderMosaic(
    colors.map((_, i) => ({ identity: `fixture:${i}`, url: `https://i.scdn.co/image/${i}` })),
    {
      ...assets,
      loadImage: async (url) => sources[Number(url.split('/').at(-1))] ?? null,
    },
  )
}
