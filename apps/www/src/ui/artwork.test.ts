import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  artworkSrcset,
  artworkUrl,
  fallbackArtwork,
  preloadArtwork,
  startArtworkFallback,
} from './artwork'
import { renderArtwork } from './ssr-fixture.test-support'
import { attribute, element, findAll, first, hasClass } from './ssr-html.test-support'

const privateUrl = 'https://cdn.goosebumps.fm/user-content/private/owner/id/art.webp'

const publicUrl = 'https://cdn.goosebumps.fm/user-content/public/art.webp'

const baseURI = 'https://goosebumps.fm/editorial/fixture'

class FixtureImage extends EventTarget {
  readonly attributes = new Map<string, string>()
  readonly assignments: Array<string> = []
  readonly classList: { readonly contains: (value: string) => boolean }
  complete = true
  naturalWidth = 0
  private source: string

  constructor(src: string, artwork = true) {
    super()
    this.source = src
    this.classList = { contains: (value) => artwork && value === 'artwork' }
  }

  get src() {
    return new URL(this.source, baseURI).href
  }

  set src(value: string) {
    this.assignments.push(value)
    this.source = value
  }

  hasAttribute(name: string) {
    return this.attributes.has(name)
  }

  removeAttribute(name: string) {
    this.attributes.delete(name)
  }
}

class FixtureDocument extends EventTarget {
  readonly baseURI = baseURI

  constructor(readonly images: ReadonlyArray<FixtureImage>) {
    super()
  }

  querySelectorAll() {
    return this.images.filter((image) => image.classList.contains('artwork'))
  }

  fail(image: FixtureImage) {
    const event = new Event('error')
    Object.defineProperty(event, 'target', { value: image })
    this.dispatchEvent(event)
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('native private artwork delivery', () => {
  it('keeps the canonical path inert until the preview mount authorizes it', async () => {
    const source = first(
      findAll(
        element(
          await renderArtwork({
            src: privateUrl,
            sourceOnly: true,
          }),
        ),
        'img',
      ),
    )

    expect(attribute(source, 'data-private-media-src')).toBe(privateUrl)
    expect(attribute(source, 'src')).toBeUndefined()
    expect(artworkUrl(privateUrl, 640)).toBe(privateUrl)
    expect(artworkSrcset(privateUrl)).toBeUndefined()
    await expect(preloadArtwork(privateUrl, '100vw')).resolves.toBeUndefined()
  })

  it('never exposes a private source through the responsive artwork element', async () => {
    const image = first(findAll(element(await renderArtwork({ src: privateUrl })), 'img'))
    expect(attribute(image, 'data-private-media-src')).toBe(privateUrl)
    expect(attribute(image, 'src')).toBeUndefined()
    expect(attribute(image, 'srcset')).toBeUndefined()
    expect(attribute(image, 'sizes')).toBe('160px')
  })

  it('leaves public sources and responsive transformations unchanged', async () => {
    const image = first(
      findAll(
        element(
          await renderArtwork({
            src: publicUrl,
            sourceOnly: true,
          }),
        ),
        'img',
      ),
    )

    expect(attribute(image, 'src')).toBe(publicUrl)
    expect(attribute(image, 'data-private-media-src')).toBeUndefined()
    expect(artworkUrl(publicUrl, 640)).toBe(`${publicUrl}?w=640&q=80&f=webp`)
    expect(artworkUrl('https://other.example/cover.jpg', 640)).toBe(
      'https://other.example/cover.jpg',
    )
  })

  it('serializes all responsive CDN candidates and caller sizes through native SSR', async () => {
    const image = first(
      findAll(
        element(
          await renderArtwork({
            src: publicUrl,
            sizes: '(min-width: 640px) 112px, 80px',
          }),
        ),
        'img',
      ),
    )

    const candidates = [160, 320, 640, 960, 1280]
      .map((width) => `${publicUrl}?w=${width}&q=80&f=webp ${width}w`)
      .join(', ')

    expect(attribute(image, 'src')).toBe(`${publicUrl}?w=640&q=80&f=webp`)
    expect(attribute(image, 'srcset')).toBe(candidates)
    expect(artworkSrcset(publicUrl)).toBe(candidates)
    expect(attribute(image, 'sizes')).toBe('(min-width: 640px) 112px, 80px')
  })

  it('preserves other CDN query values while replacing transformation parameters', () => {
    expect(artworkUrl(`${publicUrl}?v=release&w=80&q=10&f=jpg`, 320)).toBe(
      `${publicUrl}?v=release&w=320&q=80&f=webp`,
    )
  })

  it('preloads the same public candidate, sizes, and responsive sources as the artwork element', async () => {
    const images: Array<{ sizes: string; srcset: string; src: string; decoded: boolean }> = []

    class PreloadImage {
      sizes = ''
      srcset = ''
      src = ''
      decoded = false

      constructor() {
        images.push(this)
      }

      decode() {
        this.decoded = true

        return Promise.resolve()
      }
    }

    vi.stubGlobal('Image', PreloadImage)
    await preloadArtwork(publicUrl, '50vw')
    expect(images).toHaveLength(1)
    expect(images[0]).toEqual({
      src: artworkUrl(publicUrl, 640),
      srcset: artworkSrcset(publicUrl),
      sizes: '50vw',
      decoded: true,
    })
  })

  it.each([
    'https://other.example/cover.jpg',
    'https://cdn.goosebumps.fm.evil.example/cover.jpg',
    '/covers/local.webp',
    'not a URL',
  ])('does not transform non-CDN source %s', async (src) => {
    expect(artworkUrl(src, 640)).toBe(src)
    expect(artworkSrcset(src)).toBeUndefined()
    const image = first(findAll(element(await renderArtwork({ src })), 'img'))
    expect(attribute(image, 'src')).toBe(src)
    expect(attribute(image, 'srcset')).toBeUndefined()
  })

  it.each(['javascript:alert(1)', 'vbscript:msgbox(1)', ' JAVASCRIPT:alert(1)'])(
    'does not serialize executable image URL %s',
    async (src) => {
      const image = first(findAll(element(await renderArtwork({ src })), 'img'))
      expect(attribute(image, 'src')).toBeUndefined()
      expect(attribute(image, 'srcset')).toBeUndefined()
    },
  )
})

describe('native artwork geometry', () => {
  it('preserves square dimensions for existing callers', async () => {
    const image = first(
      findAll(
        element(
          await renderArtwork({
            src: 'https://example.com/cover.jpg',
            alt: 'Cover',
            sizes: '160px',
          }),
        ),
        'img',
      ),
    )

    expect(image.attributes).toMatchObject({
      alt: 'Cover',
      width: '640',
      height: '640',
      loading: 'lazy',
      decoding: 'async',
      sizes: '160px',
      fetchpriority: 'auto',
    })
    expect(hasClass(image, 'artwork')).toBe(true)
  })

  it('reserves the banner aspect ratio before the image loads', async () => {
    const image = first(
      findAll(
        element(
          await renderArtwork({
            src: 'https://example.com/banner.jpg',
            alt: 'Banner',
            sizes: '750px',
            eager: true,
            className: 'banner',
            dimensions: { width: 2400, height: 800 },
          }),
        ),
        'img',
      ),
    )

    expect(image.attributes).toMatchObject({
      width: '2400',
      height: '800',
      loading: 'eager',
      fetchpriority: 'high',
      alt: 'Banner',
      sizes: '750px',
      decoding: 'async',
    })
    expect(hasClass(image, 'banner')).toBe(true)
  })

  it.each([null, ''])('uses the versioned same-origin fallback for source %s', async (src) => {
    const image = first(findAll(element(await renderArtwork({ src })), 'img'))
    expect(attribute(image, 'src')).toBe('/gb-default-v1.webp')
    expect(attribute(image, 'srcset')).toBeUndefined()
    expect(attribute(image, 'data-private-media-src')).toBeUndefined()
    expect(fallbackArtwork).toBe('/gb-default-v1.webp')
  })
})

describe('native artwork fallback lifecycle', () => {
  it('recovers pre-hydration failures and removes their responsive candidates', () => {
    const broken = new FixtureImage(publicUrl)
    broken.attributes.set('srcset', 'https://example.com/broken.webp 640w')
    const document = new FixtureDocument([broken])
    vi.stubGlobal('document', document)
    vi.stubGlobal('HTMLImageElement', FixtureImage)
    const stop = startArtworkFallback()
    expect(broken.src).toBe(new URL(fallbackArtwork, baseURI).href)
    expect(broken.hasAttribute('srcset')).toBe(false)
    document.fail(broken)
    expect(broken.assignments).toEqual([fallbackArtwork])
    stop()
  })

  it('keeps pending and authorized private images inert on startup and capture errors', () => {
    const pending = new FixtureImage('/empty')
    pending.attributes.set('data-private-media-src', privateUrl)
    const authorized = new FixtureImage(privateUrl)
    const document = new FixtureDocument([pending, authorized])
    vi.stubGlobal('document', document)
    vi.stubGlobal('HTMLImageElement', FixtureImage)
    const stop = startArtworkFallback()
    document.fail(pending)
    document.fail(authorized)
    expect(pending.assignments).toEqual([])
    expect(authorized.assignments).toEqual([])
    expect(pending.hasAttribute('data-private-media-src')).toBe(true)
    stop()
  })

  it('leaves loaded, unfinished, unrelated, and fallback images alone', () => {
    const loaded = new FixtureImage(publicUrl)
    loaded.naturalWidth = 640
    const loading = new FixtureImage(publicUrl)
    loading.complete = false
    const unrelated = new FixtureImage(publicUrl, false)
    const fallback = new FixtureImage(fallbackArtwork)
    const document = new FixtureDocument([loaded, loading, unrelated, fallback])
    vi.stubGlobal('document', document)
    vi.stubGlobal('HTMLImageElement', FixtureImage)
    const stop = startArtworkFallback()
    document.fail(unrelated)
    document.fail(fallback)
    expect([loaded, loading, unrelated, fallback].map((image) => image.assignments)).toEqual([
      [],
      [],
      [],
      [],
    ])
    stop()
  })

  it('stops recovering capture errors when its scope disposer runs', () => {
    const image = new FixtureImage(publicUrl)
    image.complete = false
    const document = new FixtureDocument([image])
    vi.stubGlobal('document', document)
    vi.stubGlobal('HTMLImageElement', FixtureImage)
    const stop = startArtworkFallback()
    stop()
    stop()
    document.fail(image)
    expect(image.assignments).toEqual([])
    expect(image.src).toBe(publicUrl)
  })

  it('removes the capture handler from its acquired document rather than a later ambient document', () => {
    const image = new FixtureImage(publicUrl)
    image.complete = false
    const original = new FixtureDocument([image])
    const replacement = new FixtureDocument([])
    vi.stubGlobal('document', original)
    vi.stubGlobal('HTMLImageElement', FixtureImage)
    const stop = startArtworkFallback()
    vi.stubGlobal('document', replacement)
    stop()
    original.fail(image)
    expect(image.assignments).toEqual([])
    expect(image.src).toBe(publicUrl)
  })

  it('unsubscribes before an acquired Effect scope has finished closing', async () => {
    const image = new FixtureImage(publicUrl)
    image.complete = false
    const document = new FixtureDocument([image])
    vi.stubGlobal('document', document)
    vi.stubGlobal('HTMLImageElement', FixtureImage)
    await Effect.runPromise(
      Effect.acquireRelease(Effect.sync(startArtworkFallback), (stop) => Effect.sync(stop)).pipe(
        Effect.scoped,
      ),
    )
    document.fail(image)
    expect(image.assignments).toEqual([])
    expect(image.src).toBe(publicUrl)
  })
})
