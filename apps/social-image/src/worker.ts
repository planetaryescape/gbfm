import {
  SocialCardPresentation,
  type SocialCardFormat,
  type SocialCardKind,
  type SocialCardModel,
} from '@gbfm/social-card'
import { Schema } from 'effect'

import resvgWasm from '../assets/resvg.wasm'
import yogaWasm from '../assets/yoga.wasm'
import { handleMosaic } from './mosaic-handler'
import { loadMosaicImage } from './mosaic-image'
import { renderSocialCard, type SocialCardRenderAssets } from './render'

type Fetcher = {
  readonly fetch: (request: Request) => Promise<Response>
}

type StoredObject = {
  readonly body: BodyInit
}

type ListedObject = {
  readonly key: string
  readonly uploaded: Date
}

type ObjectList = {
  readonly objects: ReadonlyArray<ListedObject>
  readonly truncated: boolean
  readonly cursor?: string
}

type CardBucket = {
  readonly get: (key: string) => Promise<StoredObject | null>
  readonly put: (
    key: string,
    bytes: Uint8Array,
    options?: { readonly httpMetadata: { readonly contentType: string } },
  ) => Promise<void>
  list: (options?: { readonly prefix?: string; readonly cursor?: string }) => Promise<ObjectList>
  readonly delete: (keys: string | Array<string>) => Promise<void>
}

/** Bindings used by the social image Worker. */
export interface SocialImageEnv {
  readonly API: Fetcher
  readonly ASSETS: Fetcher
  readonly CARDS: CardBucket
}

type Render = (model: SocialCardModel, format: SocialCardFormat) => Promise<Uint8Array>

type ImageFetcher = (url: URL, init: RequestInit) => Promise<Response>

type ImageRoute = {
  readonly kind: SocialCardKind
  readonly slug: string
  readonly revision: string
  readonly format: SocialCardFormat
  readonly legacy: boolean
}

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const CURRENT_CARD_PREFIX = 'social-cards/'

const workerConsole = console

// Keep scanning the previous Worker's prefix until its deployed objects have aged past retention.
const LEGACY_TWEET_CARD_PREFIX = 'tweet-cards/'

const approvedImageHosts = new Set([
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

const approvedImageHostSuffixes = [
  '.archive.org',
  '.bcbits.com',
  '.dzcdn.net',
  '.mzstatic.com',
  '.sndcdn.com',
  '.spotifycdn.com',
  '.ytimg.com',
] as const

const approvedImageUrl = (value: string) => {
  try {
    const url = new URL(value)

    if (url.protocol !== 'https:' || url.username || url.password) return null

    if (
      !approvedImageHosts.has(url.hostname) &&
      !approvedImageHostSuffixes.some((suffix) => url.hostname.endsWith(suffix))
    ) {
      return null
    }

    return url
  } catch {
    return null
  }
}

const cacheHeaders = {
  'cache-control': 'public, max-age=31536000, immutable',
  'content-type': 'image/png',
  'x-content-type-options': 'nosniff',
}

const imageFormat = (filename: string): SocialCardFormat | null => {
  if (filename === 'poster.png') return 'poster'

  if (filename === 'sleeve.png') return 'sleeve'

  if (filename === 'open-graph.png') return 'openGraph'

  return null
}

const cardKind = (value: string): SocialCardKind | null => {
  switch (value) {
    case 'mix':
    case 'track':
    case 'release':
    case 'show':
    case 'label':
    case 'profile':
    case 'editorial':
    case 'tweet':
      return value
    default:
      return null
  }
}

const parseImagePath = (pathname: string): ImageRoute | null => {
  const genericMatch = /^\/social\/cards\/([^/]+)\/([^/]+)\/([a-f0-9]{16})\/([^/]+)$/.exec(pathname)
  const legacyMatch = /^\/social\/tweets\/([^/]+)\/([a-f0-9]{16})\/([^/]+)$/.exec(pathname)
  const match = genericMatch ?? legacyMatch

  if (!match) return null
  const kindValue = genericMatch?.[1] ?? 'tweet'
  const encodedSlug = genericMatch?.[2] ?? legacyMatch?.[1]
  const revision = genericMatch?.[3] ?? legacyMatch?.[2]
  const filename = genericMatch?.[4] ?? legacyMatch?.[3]

  if (!kindValue) return null
  const kind = cardKind(kindValue)

  if (!kind) return null
  const format = filename ? imageFormat(filename) : null

  if (!encodedSlug || !revision || !format) return null

  if (kind !== 'tweet' && format !== 'openGraph') return null

  try {
    return {
      kind,
      slug: decodeURIComponent(encodedSlug),
      revision,
      format,
      legacy: legacyMatch !== null,
    }
  } catch {
    return null
  }
}

const decodePresentation = Schema.decodeUnknownSync(SocialCardPresentation)

const fetchPresentation = async (env: SocialImageEnv, route: ImageRoute, signal: AbortSignal) => {
  const response = await env.API.fetch(
    new Request(
      `https://api.internal/api/social-cards/${route.kind}/${encodeURIComponent(route.slug)}`,
      { signal },
    ),
  )

  if (response.status === 404) return null

  if (!response.ok) throw new Error(`Social card API returned ${response.status}`)
  const presentation = decodePresentation(await response.json())

  if (presentation.model.kind !== route.kind) {
    throw new Error('Social card API returned a mismatched kind')
  }

  return presentation
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }

  return btoa(binary)
}

/** Loads an approved remote image without allowing redirects to escape the host allowlist. */
export const loadRemoteImage = async (
  value: string,
  fetchImage: ImageFetcher = fetch,
): Promise<string | null> => {
  try {
    const url = approvedImageUrl(value)

    if (!url) return null
    const response = await fetchImage(url, { signal: AbortSignal.timeout(5_000) })

    if (!response.ok || !approvedImageUrl(response.url)) return null
    const contentType = response.headers.get('content-type')?.split(';')[0]
    const declaredSize = Number(response.headers.get('content-length') ?? 0)

    if (!contentType?.startsWith('image/') || declaredSize > MAX_IMAGE_BYTES) return null
    const bytes = new Uint8Array(await response.arrayBuffer())

    if (bytes.byteLength > MAX_IMAGE_BYTES) return null

    return `data:${contentType};base64,${bytesToBase64(bytes)}`
  } catch {
    return null
  }
}

const renderAssets = (env: SocialImageEnv): SocialCardRenderAssets => ({
  loadWasm: async (name) => (name === 'yoga.wasm' ? yogaWasm : resvgWasm),
  loadFont: async (name) => {
    const response = await env.ASSETS.fetch(new Request(`https://assets.internal/${name}`))

    if (!response.ok) throw new Error(`Render asset ${name} returned ${response.status}`)

    return response.arrayBuffer()
  },
  loadImage: loadRemoteImage,
})

const imageFor = (presentation: SocialCardPresentation, format: SocialCardFormat) => {
  if (format === 'openGraph') return presentation.images.openGraph

  return 'poster' in presentation.images ? presentation.images[format] : null
}

/** Serves immutable generated cards and redirects stale revisions to current content. */
export const handleRequest = async (
  request: Request,
  env: SocialImageEnv,
  render?: Render,
): Promise<Response> => {
  if (new URL(request.url).pathname === '/internal/mosaic') {
    return handleMosaic(request, {
      ...renderAssets(env),
      loadImage: (url) => loadMosaicImage(url, fetch, { signal: request.signal }),
    })
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }

  const route = parseImagePath(new URL(request.url).pathname)

  if (!route) return new Response('Not found', { status: 404 })

  try {
    const presentation = await fetchPresentation(env, route, request.signal)

    if (!presentation) return new Response('Not found', { status: 404 })
    const currentImage = imageFor(presentation, route.format)

    if (!currentImage) return new Response('Not found', { status: 404 })

    if (route.legacy || presentation.revision !== route.revision) {
      return Response.redirect(currentImage, 302)
    }

    const key = `social-cards/${route.kind}/${route.slug}/${route.revision}/${route.format}.png`
    let cached: StoredObject | null

    try {
      cached = await env.CARDS.get(key)
    } catch (error) {
      workerConsole.error('social image cache read failed', {
        format: route.format,
        revision: route.revision,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      cached = null
    }

    if (cached) {
      return new Response(request.method === 'HEAD' ? null : cached.body, { headers: cacheHeaders })
    }

    const bytes = await (
      render ?? ((model, format) => renderSocialCard(model, format, renderAssets(env)))
    )(presentation.model, route.format)

    try {
      await env.CARDS.put(key, bytes, { httpMetadata: { contentType: 'image/png' } })
    } catch (error) {
      workerConsole.error('social image cache write failed', {
        format: route.format,
        revision: route.revision,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    }

    return new Response(request.method === 'HEAD' ? null : bytes, { headers: cacheHeaders })
  } catch (error) {
    workerConsole.error('social image request failed', {
      method: request.method,
      kind: route.kind,
      format: route.format,
      revision: route.revision,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })

    return new Response('Image generation failed', { status: 500 })
  }
}

/** Deletes generated cards after 30 days; a requested current revision regenerates on demand. */
export const cleanupExpiredCards = async (bucket: CardBucket, now: Date) => {
  const cutoff = now.getTime() - RETENTION_MS
  let scanned = 0
  let deleted = 0

  for (const prefix of [CURRENT_CARD_PREFIX, LEGACY_TWEET_CARD_PREFIX]) {
    let cursor: string | undefined

    do {
      const page = await bucket.list({ prefix, ...(cursor ? { cursor } : undefined) })
      scanned += page.objects.length

      const expired = page.objects
        .filter((object) => object.uploaded.getTime() < cutoff)
        .map((object) => object.key)

      if (expired.length > 0) {
        await bucket.delete(expired)
        deleted += expired.length
      }

      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }

  return { scanned, deleted }
}

export default {
  fetch: (request: Request, env: SocialImageEnv, _context: Pick<ExecutionContext, 'waitUntil'>) =>
    handleRequest(request, env),
  scheduled: (_controller: ScheduledController, env: SocialImageEnv): Promise<void> =>
    cleanupExpiredCards(env.CARDS, new Date()).then((report) => {
      workerConsole.log('social image cleanup finished', report)
    }),
}
