import { readFile } from 'node:fs/promises'

import { handleMosaic } from '../../../social-image/src/mosaic-handler'
import { loadMosaicImage } from '../../../social-image/src/mosaic-image'

export const renderMosaicInDevelopment = (request: Request) =>
  handleMosaic(request, {
    loadWasm: async (name) => {
      const bytes = await readFile(new URL(`../../../social-image/assets/${name}`, import.meta.url))

      return new Uint8Array(bytes).buffer
    },
    loadFont: async () => new ArrayBuffer(0),
    loadImage: (url) => loadMosaicImage(url, fetch, { signal: request.signal }),
  })
