import { inertHtml as h } from 'foldkit/html'

import { isPrivateMedia } from '../media-preview/session'

/** Versioned, lossless copy of the default cover, served without a third-party connection. */
export const fallbackArtwork = '/gb-default-v1.webp'

/** Hold private images inert until the root Mount has installed the exact-path cookie. */
export const imageSource = (src: string) =>
  isPrivateMedia(src) ? h.DataAttribute('private-media-src', src) : h.Src(src)

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

const srcset = (original: string) =>
  artworkUrl(original, 640) === original
    ? null
    : [160, 320, 640, 960, 1280]
        .map((width) => `${artworkUrl(original, width)} ${width}w`)
        .join(', ')

/** Fetches and decodes the exact candidate an `artwork` with the same sizes will pick, so it paints without a gap. */
export const preloadArtwork = (src: string | null | undefined, sizes: string) => {
  const original = src || fallbackArtwork

  if (isPrivateMedia(original)) return Promise.resolve()
  const image = new Image()
  const candidates = srcset(original)
  image.sizes = sizes

  if (candidates) image.srcset = candidates
  image.src = artworkUrl(original, 640)

  return image.decode().catch(() => undefined)
}

export const artwork = (
  src: string | null | undefined,
  alt: string,
  sizes: string,
  eager = false,
  className = '',
  dimensions: Readonly<{ width: number; height: number }> = { width: 640, height: 640 },
) => {
  const original = src || fallbackArtwork
  const candidates = srcset(original)

  return h.img([
    imageSource(artworkUrl(original, 640)),
    h.Alt(alt),
    h.Class(`artwork ${className}`.trim()),
    h.Width(String(dimensions.width)),
    h.Height(String(dimensions.height)),
    h.Sizes(sizes),
    ...(candidates ? [h.Srcset(candidates)] : []),
    h.Loading(eager ? 'eager' : 'lazy'),
    h.Decoding('async'),
    h.Fetchpriority(eager ? 'high' : 'auto'),
  ])
}

/** Capturing error events also covers image failures before hydration and avoids fallback loops. */
export const startArtworkFallback = () => {
  const recover = (image: HTMLImageElement) => {
    if (
      !image.classList.contains('artwork') ||
      image.hasAttribute('data-private-media-src') ||
      isPrivateMedia(image.src) ||
      image.src === new URL(fallbackArtwork, document.baseURI).href
    )
      return
    image.removeAttribute('srcset')
    image.src = fallbackArtwork
  }

  const onError = (event: Event) => {
    if (event.target instanceof HTMLImageElement) recover(event.target)
  }

  document.addEventListener('error', onError, true)
  document.querySelectorAll('img.artwork').forEach((image) => {
    if (image instanceof HTMLImageElement && image.complete && image.naturalWidth === 0)
      recover(image)
  })

  return () => document.removeEventListener('error', onError, true)
}
