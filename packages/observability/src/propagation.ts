export const tracePropagationTargets = (input: {
  readonly origin?: string
  readonly apiUrl?: string
  readonly development: boolean
}) => {
  const origins = new Set([
    'https://goosebumps.fm',
    'https://www.goosebumps.fm',
    'https://api.goosebumps.fm',
  ])

  for (const value of [input.origin, input.apiUrl]) {
    const url = value ? URL.parse(value) : null

    if (!url || url.username || url.password) continue

    if (url.protocol === 'https:' || (input.development && url.protocol === 'http:'))
      origins.add(url.origin)
  }

  return [...origins].map(
    (origin) => new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/|$)`),
  )
}

const sentryTrace = /^([a-f0-9]{32})-([a-f0-9]{16})(?:-([01]))?$/

const w3cTrace = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/

const validParent = (match: RegExpExecArray | null) =>
  match?.[1] && match[2] && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2]) ? match : undefined

const baggageValues = new Map([
  ['sentry-trace_id', /^[a-f0-9]{32}$/],
  ['sentry-public_key', /^[a-f0-9]+$/],
  ['sentry-org_id', /^\d+$/],
  ['sentry-release', /^gbfm-(?:www|mobile|api)@[a-f0-9]{40}$/],
  ['sentry-environment', /^(?:production|preview|development)$/],
  ['sentry-sample_rate', /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/],
  ['sentry-sample_rand', /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/],
  ['sentry-sampled', /^(?:true|false)$/],
])

export const propagatedHeaders = (source: Headers) => {
  const headers = new Headers(source)
  const sentry = validParent(sentryTrace.exec(headers.get('sentry-trace') ?? ''))
  const w3c = validParent(w3cTrace.exec(headers.get('traceparent') ?? ''))
  const parent = sentry ?? w3c
  const traceId = parent?.[1]
  const spanId = parent?.[2]

  headers.delete('sentry-trace')
  headers.delete('traceparent')
  headers.delete('tracestate')
  headers.delete('baggage')
  headers.delete('b3')

  for (const key of source.keys()) if (key.startsWith('x-b3-')) headers.delete(key)

  if (!traceId || !spanId) return headers

  const sampling =
    sentry?.[3] ?? (sentry ? undefined : String(Number.parseInt(w3c?.[3] ?? '00', 16) & 1))

  const parentValue = `${traceId}-${spanId}`
  headers.set('sentry-trace', sampling === undefined ? parentValue : `${parentValue}-${sampling}`)

  if (sampling !== undefined)
    headers.set('traceparent', `00-${traceId}-${spanId}-${sampling === '1' ? '01' : '00'}`)

  const baggage = source.get('baggage') ?? ''

  if (baggage.length <= 8192) {
    const reviewed = new Map<string, string>()

    for (const member of baggage.split(',').slice(0, 32)) {
      const [key, value] = member.trim().split('=')
      const pattern = key ? baggageValues.get(key) : undefined

      if (key && value && value.length <= 160 && pattern?.test(value)) reviewed.set(key, value)
    }

    reviewed.set('sentry-trace_id', traceId)
    headers.set('baggage', [...reviewed].map(([key, value]) => `${key}=${value}`).join(','))
  }

  return headers
}

export const propagatedRequest = (request: Request) =>
  new Request(request, { headers: propagatedHeaders(request.headers) })

export const remoteTraceContext = (headers: Headers) => {
  const parent = sentryTrace.exec(propagatedHeaders(headers).get('sentry-trace') ?? '')
  const traceId = parent?.[1]
  const spanId = parent?.[2]

  if (!traceId || !spanId) return undefined

  if (parent?.[3] === undefined) return { traceId, spanId }

  return { traceId, spanId, sampled: parent[3] === '1' }
}
