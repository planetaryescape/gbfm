import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { isPrivateMedia } from '../media-preview/session'

/** Versioned, lossless copy of the default cover, served without a third-party connection. */
export const fallbackArtwork = '/gb-default-v1.webp'

/** Hold private images inert until the root Mount has installed the exact-path cookie. */
export const imageSource = <Message>(h: Html.H<Message>, src: string) =>
  isPrivateMedia(src) ? h.img.attr('data-private-media-src', src) : h.img.attr('src', src)

/** Only the GBFM image CDN accepts transformation parameters; original/external URLs stay valid. */
export const artworkUrl = (src: string, width: number): string => {
  if (isPrivateMedia(src)) return src
  let url: URL

  try {
    url = new URL(src)
  } catch {
    return src
  }

  if (url.hostname !== 'cdn.goosebumps.fm') return src
  url.searchParams.set('w', String(width))
  url.searchParams.set('q', '80')
  url.searchParams.set('f', 'webp')

  return url.toString()
}

export const artworkSrcset = (original: string) =>
  artworkUrl(original, 640) === original
    ? undefined
    : [160, 320, 640, 960, 1280]
        .map((width) => `${artworkUrl(original, width)} ${width}w`)
        .join(', ')

/** Fetches and decodes the exact candidate an `artwork` with the same sizes will pick, so it paints without a gap. */
export const preloadArtwork = (src: string | null | undefined, sizes: string) => {
  const original = src || fallbackArtwork

  if (isPrivateMedia(original)) return Promise.resolve()
  const image = new Image()
  const candidates = artworkSrcset(original)
  image.sizes = sizes

  if (candidates) image.srcset = candidates
  image.src = artworkUrl(original, 640)

  return image.decode().catch(() => undefined)
}

export const artwork = <Message>(
  h: Html.H<Message>,
  src: string | null | undefined,
  alt: string,
  sizes: string,
  eager = false,
  className = '',
  dimensions: Readonly<{ width: number; height: number }> = { width: 640, height: 640 },
): View.Content<Message> => {
  const original = src || fallbackArtwork

  return imageSource(h, artworkUrl(original, 640))
    .attr('alt', alt)
    .class(`artwork ${className}`.trim())
    .attr('width', String(dimensions.width))
    .attr('height', String(dimensions.height))
    .attr('sizes', sizes)
    .attr('srcset', artworkSrcset(original))
    .attr('loading', eager ? 'eager' : 'lazy')
    .attr('decoding', 'async')
    .attr('fetchpriority', eager ? 'high' : 'auto')
}

export const shouldFallbackArtwork = (image: HTMLImageElement, baseUri: string): boolean =>
  image.classList.contains('artwork') &&
  !image.hasAttribute('data-private-media-src') &&
  !isPrivateMedia(image.src) &&
  image.src !== new URL(fallbackArtwork, baseUri).href

/** Capturing error events also covers image failures before hydration and avoids fallback loops. */
export const startArtworkFallback = () => {
  const ownerDocument = document
  const capture = { capture: true }

  const recover = (image: HTMLImageElement) => {
    if (!shouldFallbackArtwork(image, ownerDocument.baseURI)) return
    image.removeAttribute('srcset')
    image.src = fallbackArtwork
  }

  const onError = (event: Event) => {
    if (event.target instanceof HTMLImageElement) recover(event.target)
  }

  ownerDocument.addEventListener('error', onError, capture)
  ownerDocument.querySelectorAll('img.artwork').forEach((image) => {
    if (image instanceof HTMLImageElement && image.complete && image.naturalWidth === 0)
      recover(image)
  })

  return () => ownerDocument.removeEventListener('error', onError, capture)
}
