import { Match, Predicate, Schema } from 'effect'

import type { RichContentBlock, RichContentDocument, RichContentInline } from './schema'

export const MOSAIC_RECIPE = 'reading-order-grid-v1'

export const MOSAIC_SIZE = 1200

export const MAX_MOSAIC_CANDIDATES = 16

const hosts = new Set([
  'archive.org',
  'cdn.goosebumps.fm',
  'coverartarchive.org',
  'd20tmfka7s58bt.cloudfront.net',
  'i.scdn.co',
  'images-na.ssl-images-amazon.com',
  'img.youtube.com',
  'm.media-amazon.com',
  'mosaic.scdn.co',
  'resources.tidal.com',
])

const suffixes = [
  '.archive.org',
  '.bcbits.com',
  '.dzcdn.net',
  '.mzstatic.com',
  '.sndcdn.com',
  '.spotifycdn.com',
  '.ytimg.com',
]

export const mosaicImageUrl = (value: string): URL | null => {
  const url = URL.parse(value)

  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port) return null

  if (!hosts.has(url.hostname) && !suffixes.some((suffix) => url.hostname.endsWith(suffix)))
    return null

  if (
    url.hostname === 'cdn.goosebumps.fm' &&
    /^\/(?:(?:user-content|mixes)\/)?private\//.test(url.pathname)
  )
    return null
  url.hash = ''

  return url
}

const ImageUrl = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((value) => mosaicImageUrl(value) !== null)),
)

export const MosaicCandidate = Schema.Struct({ identity: Schema.String, url: ImageUrl })

export type MosaicCandidate = typeof MosaicCandidate.Type

export const MosaicRequest = Schema.Struct({
  candidates: Schema.Array(MosaicCandidate).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_MOSAIC_CANDIDATES)),
  ),
})

export const MosaicRecipe = Schema.Struct({
  version: Schema.Literal(MOSAIC_RECIPE),
  images: Schema.Array(MosaicCandidate).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4)),
  ),
})

export type MosaicRecipe = typeof MosaicRecipe.Type

export const discoverMosaicImages = (
  document: RichContentDocument,
): ReadonlyArray<MosaicCandidate> => {
  const candidates: Array<MosaicCandidate> = []
  const identities = new Set<string>()
  const urls = new Set<string>()

  const add = (value: string | null, identity?: string) => {
    const url = value ? mosaicImageUrl(value)?.href : null

    if (
      !url ||
      candidates.length >= MAX_MOSAIC_CANDIDATES ||
      urls.has(url) ||
      identities.has(identity ?? url)
    )
      return
    identities.add(identity ?? url)
    urls.add(url)
    candidates.push({ identity: identity ?? url, url })
  }

  const inline = (items: ReadonlyArray<RichContentInline>): void => {
    for (const item of items) {
      if (Predicate.isTagged(item, 'Image')) add(item.src)
      else if ('children' in item) inline(item.children)
    }
  }

  const blocks = (items: ReadonlyArray<RichContentBlock>): void => {
    for (const item of items) {
      Match.value(item).pipe(
        Match.tag('MusicEmbed', (item) => {
          add(
            item.music.imageUrl,
            item.music.entityId ? `${item.music.entityType}:${item.music.entityId}` : undefined,
          )
        }),
        Match.tag('Paragraph', (item) => inline(item.children)),
        Match.tag('Heading', (item) => inline(item.children)),
        Match.tag('Quote', (item) => blocks(item.children)),
        Match.tag('CardGroup', (item) => blocks(item.children)),
        Match.tag('List', (item) => {
          for (const entry of item.items) blocks(entry.children)
        }),
        Match.tag('Table', (item) => {
          for (const row of item.rows) for (const cell of row) inline(cell)
        }),
        Match.orElse(() => undefined),
      )
    }
  }

  blocks(document.blocks)

  return candidates
}

export const makeMosaicRecipe = (images: ReadonlyArray<MosaicCandidate>): MosaicRecipe | null => {
  const selected: Array<MosaicCandidate> = []
  const identities = new Set<string>()
  const urls = new Set<string>()

  for (const image of images) {
    if (identities.has(image.identity) || urls.has(image.url)) continue
    identities.add(image.identity)
    urls.add(image.url)
    selected.push(image)

    if (selected.length === 4) break
  }

  return selected.length ? { version: MOSAIC_RECIPE, images: selected } : null
}

export const mosaicTiles = (recipe: MosaicRecipe) =>
  recipe.images.map((image, index) => {
    const count = recipe.images.length

    if (count === 1) return { image, x: 0, y: 0, width: 1, height: 1 }

    if (count === 2) return { image, x: index / 2, y: 0, width: 0.5, height: 1 }

    if (count === 3)
      return index === 0
        ? { image, x: 0, y: 0, width: 0.5, height: 1 }
        : { image, x: 0.5, y: (index - 1) / 2, width: 0.5, height: 0.5 }

    return { image, x: (index % 2) / 2, y: Math.floor(index / 2) / 2, width: 0.5, height: 0.5 }
  })

export const mosaicRevision = async (recipe: MosaicRecipe) => {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(recipe)),
  )

  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
