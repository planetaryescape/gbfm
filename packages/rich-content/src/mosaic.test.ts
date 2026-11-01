import { Option, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import fixture from './fixtures/mosaic.json'
import {
  discoverMosaicImages,
  makeMosaicRecipe,
  mosaicImageUrl,
  mosaicRevision,
  mosaicTiles,
  MosaicRequest,
} from './mosaic'
import { RichContentDocument } from './schema'

const image = (id: number) => ({ identity: `album:${id}`, url: `https://i.scdn.co/image/${id}` })

describe('mosaic recipe', () => {
  test('discovers nested inline images and album covers in reading order without duplicates', () => {
    const document = Schema.decodeUnknownSync(RichContentDocument)(fixture)

    expect(discoverMosaicImages(document).map(({ url }) => url)).toEqual([
      image(1).url,
      image(2).url,
      image(3).url,
    ])
  })

  test.each([1, 2, 3, 4])('fills the square without gaps or overlap with %i images', (count) => {
    const recipe = makeMosaicRecipe(Array.from({ length: count }, (_, i) => image(i)))
    expect(recipe).not.toBeNull()

    if (!recipe) return
    const tiles = mosaicTiles(recipe)
    expect(tiles.reduce((area, tile) => area + tile.width * tile.height, 0)).toBe(1)

    for (const tile of tiles) {
      expect(tile.x + tile.width).toBeLessThanOrEqual(1)
      expect(tile.y + tile.height).toBeLessThanOrEqual(1)

      for (const other of tiles) {
        if (tile === other) continue
        expect(
          tile.x >= other.x + other.width ||
            other.x >= tile.x + tile.width ||
            tile.y >= other.y + other.height ||
            other.y >= tile.y + tile.height,
        ).toBe(true)
      }
    }
  })

  test('takes four distinct images and produces stable, order-sensitive revisions', async () => {
    const recipe = makeMosaicRecipe([image(0), image(0), image(1), image(2), image(3), image(4)])
    expect(recipe?.images).toEqual([image(0), image(1), image(2), image(3)])

    if (!recipe) return
    expect(await mosaicRevision(recipe)).toBe(await mosaicRevision(recipe))
    expect(await mosaicRevision({ ...recipe, images: [...recipe.images].reverse() })).not.toBe(
      await mosaicRevision(recipe),
    )
    expect(makeMosaicRecipe([])).toBeNull()
  })

  test.each([
    'http://i.scdn.co/image/a',
    'https://i.scdn.co.evil.test/a',
    'https://127.0.0.1/a',
    'https://i.scdn.co:444/a',
    'https://user:pass@i.scdn.co/a',
    'https://cdn.goosebumps.fm/user-content/private/owner/image.png',
    'data:image/png;base64,AAA',
    '/image.png',
  ])('rejects unsafe or private image source %s', (value) => {
    expect(mosaicImageUrl(value)).toBeNull()
  })

  test('bounds the renderer request and rejects unsafe candidates', () => {
    const decode = Schema.decodeUnknownOption(MosaicRequest)
    expect(Option.isNone(decode({ candidates: [] }))).toBe(true)
    expect(
      Option.isNone(decode({ candidates: Array.from({ length: 17 }, (_, i) => image(i)) })),
    ).toBe(true)
    expect(
      Option.isNone(decode({ candidates: [{ identity: 'x', url: 'https://localhost/x' }] })),
    ).toBe(true)
  })
})
