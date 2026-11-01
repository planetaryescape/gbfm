import {
  makeMosaicRecipe,
  mosaicRevision,
  mosaicTiles,
  MOSAIC_SIZE,
  type MosaicCandidate,
} from '@gbfm/rich-content/mosaic'
import { Resvg } from '@resvg/resvg-wasm'
import { createElement } from 'react'
import satori from 'satori/standalone'

import { initializeRuntime, type SocialCardRenderAssets } from './render-runtime'

export const renderMosaic = async (
  candidates: ReadonlyArray<MosaicCandidate>,
  assets: SocialCardRenderAssets,
) => {
  const usable: Array<MosaicCandidate> = []
  const images = new Map<string, string>()

  for (let offset = 0; offset < candidates.length && usable.length < 4; offset += 4) {
    const batch = candidates.slice(offset, offset + 4)

    const loaded = await Promise.all(
      batch.map(async (candidate) => ({ candidate, data: await assets.loadImage(candidate.url) })),
    )

    for (const { candidate, data } of loaded) {
      if (
        !data ||
        images.has(candidate.url) ||
        usable.some((image) => image.identity === candidate.identity)
      )
        continue
      usable.push(candidate)
      images.set(candidate.url, data)

      if (usable.length === 4) break
    }
  }

  const recipe = makeMosaicRecipe(usable)

  if (!recipe) return null
  await initializeRuntime(assets)

  const svg = await satori(
    createElement(
      'div',
      {
        style: {
          display: 'flex',
          position: 'relative',
          width: MOSAIC_SIZE,
          height: MOSAIC_SIZE,
          background: '#171717',
        },
      },
      mosaicTiles(recipe).map(({ image, x, y, width, height }) =>
        createElement('img', {
          alt: '',
          key: image.identity,
          src: images.get(image.url),
          width: width * MOSAIC_SIZE,
          height: height * MOSAIC_SIZE,
          style: {
            position: 'absolute',
            left: x * MOSAIC_SIZE,
            top: y * MOSAIC_SIZE,
            objectFit: 'cover',
          },
        }),
      ),
    ),
    { width: MOSAIC_SIZE, height: MOSAIC_SIZE, fonts: [] },
  )

  const renderer = new Resvg(svg, { font: { loadSystemFonts: false } })

  try {
    return { png: renderer.render().asPng(), revision: await mosaicRevision(recipe), recipe }
  } finally {
    renderer.free()
  }
}
