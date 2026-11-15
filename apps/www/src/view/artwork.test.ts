import { inertHtml as h } from 'foldkit/html'
import { describe, expect, it } from 'vitest'

import { artwork, artworkUrl, imageSource, preloadArtwork } from './artwork'

describe('private artwork delivery', () => {
  it('keeps the canonical path inert until the preview Mount authorizes it', async () => {
    const url = 'https://cdn.goosebumps.fm/user-content/private/owner/id/art.webp'
    expect(imageSource(url)).toEqual(h.DataAttribute('private-media-src', url))
    expect(artworkUrl(url, 640)).toBe(url)
    // No Image global exists here: private preload must not start an unauthorized request.
    await expect(preloadArtwork(url, '100vw')).resolves.toBeUndefined()
  })

  it('leaves public sources and responsive transformations unchanged', () => {
    const url = 'https://cdn.goosebumps.fm/user-content/public/art.webp'
    expect(imageSource(url)).toEqual(h.Src(url))
    expect(artworkUrl(url, 640)).toBe(`${url}?w=640&q=80&f=webp`)
    expect(artworkUrl('https://other.example/cover.jpg', 640)).toBe(
      'https://other.example/cover.jpg',
    )
  })
})

describe('artwork geometry', () => {
  it('preserves square dimensions for existing callers', () => {
    const image = artwork('https://example.com/cover.jpg', 'Cover', '160px')
    expect(image?.data?.attrs).toMatchObject({ width: '640', height: '640', loading: 'lazy' })
  })

  it('reserves the banner aspect ratio before the image loads', () => {
    const image = artwork('https://example.com/banner.jpg', 'Banner', '750px', true, 'banner', {
      width: 2400,
      height: 800,
    })

    expect(image?.data?.attrs).toMatchObject({
      width: '2400',
      height: '800',
      loading: 'eager',
      fetchpriority: 'high',
    })
  })
})
