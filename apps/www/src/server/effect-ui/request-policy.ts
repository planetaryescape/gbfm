const assetExtensions = new Set(
  'avif bmp cjs css csv eot gif gz ico jpeg jpg js json map mjs mp3 mp4 ogg otf pdf png svg ttf txt wasm wav webm webmanifest webp woff woff2 xml zip'.split(
    ' ',
  ),
)

const assetDestinations = new Set(
  'audio audioworklet embed font image manifest object paintworklet script serviceworker sharedworker style track video worker xslt'.split(
    ' ',
  ),
)

export const refusedMethods = new Set(['CONNECT', 'TRACE', 'TRACK'])

export const allowedMethods = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'

export const varyWith = (existing: string | null, ...fields: ReadonlyArray<string>): string => {
  const tokens = (existing ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)

  const seen = new Set(tokens.map((token) => token.toLowerCase()))

  if (seen.has('*')) return '*'

  for (const field of fields) {
    if (!seen.has(field.toLowerCase())) {
      tokens.push(field)
      seen.add(field.toLowerCase())
    }
  }

  return tokens.join(', ')
}

const splitHeader = (value: string, delimiter: string): Array<string> => {
  const parts: Array<string> = []
  let current = ''
  let quoted = false
  let escaped = false

  for (const character of value) {
    if (escaped) escaped = false
    else if (quoted && character === '\\') escaped = true
    else if (character === '"') quoted = !quoted
    else if (!quoted && character === delimiter) {
      parts.push(current)
      current = ''
      continue
    }

    current += character
  }

  parts.push(current)

  return parts
}

export const acceptsHtml = (header: string | null): boolean => {
  if (!header?.trim()) return true
  let bestSpecificity = 0
  let bestQuality = 0

  for (const range of splitHeader(header, ',')) {
    const [mediaType, ...parameters] = splitHeader(range, ';')
    const media = mediaType?.trim().toLowerCase()
    let specificity = 0

    if (media === 'text/html') specificity = 3
    else if (media === 'text/*') specificity = 2
    else if (media === '*/*') specificity = 1

    if (specificity <= bestSpecificity) continue
    let quality = 1

    for (const parameter of parameters) {
      const separator = parameter.indexOf('=')

      if (separator < 0 || parameter.slice(0, separator).trim().toLowerCase() !== 'q') continue
      const parsed = Number(parameter.slice(separator + 1).trim())
      quality = Number.isNaN(parsed) ? 1 : parsed
      break
    }

    bestSpecificity = specificity
    bestQuality = quality
  }

  return bestSpecificity > 0 && bestQuality > 0
}

const decodedPath = (url: string): string => {
  const path = new URL(url).pathname

  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export const resolvesToIndex = (url: string): boolean => {
  const path = decodedPath(url)

  if (path.includes('\0')) return false
  const segments: Array<string> = []

  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment === '..') segments.pop()
    else if (segment !== '' && segment !== '.') segments.push(segment)
  }

  const normalized = segments.join('/').toLowerCase()

  return normalized === '' || normalized === 'index.html'
}

export const classifyRequest = (request: Request): 'PathAsset' | 'DestinationAsset' | 'Page' => {
  const lastSegment = decodedPath(request.url).split('/').at(-1) ?? ''
  const separator = lastSegment.lastIndexOf('.')

  if (separator > 0 && assetExtensions.has(lastSegment.slice(separator + 1).toLowerCase()))
    return 'PathAsset'

  if (assetDestinations.has(request.headers.get('sec-fetch-dest')?.trim().toLowerCase() ?? ''))
    return 'DestinationAsset'

  return 'Page'
}

export const resolveRequestUrl = (target: string, origin: string): URL | undefined => {
  try {
    const base = new URL(origin)
    const url = new URL(target, base)

    if (url.username || url.password || url.origin !== base.origin) return undefined

    return url
  } catch {
    return undefined
  }
}
