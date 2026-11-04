import { Option, Schema } from 'effect'

import { NativeCallbackScheme } from './callback'
import { Continuation, parseContinuation, ProviderOutcome } from './domain'

export const oauthQuery = (params: URLSearchParams): string | null =>
  Continuation.match(parseContinuation(params), {
    Missing: () => null,
    Rejected: () => null,
    PendingVerification: ({ query }) => query,
  })

export const loginOAuthQuery = (returnTo: string, origin: string) => {
  const target = URL.parse(returnTo, origin)

  return target?.origin === origin && target.pathname === '/connect/gbfm'
    ? oauthQuery(target.searchParams)
    : null
}

const ProviderRedirect = Schema.Struct({ redirect: Schema.Literal(true), url: Schema.String })

const providerLocation = async (response: Response, origin: string, query: string) => {
  if (!response.ok) return null

  const result = Option.getOrNull(
    Schema.decodeUnknownOption(ProviderRedirect)(await response.json().catch(() => null)),
  )

  const target = result ? URL.parse(result.url, origin) : null

  if (!target) return null

  if (!['https:', 'http:'].includes(target.protocol)) {
    const callback = URL.parse(new URLSearchParams(query).get('redirect_uri') ?? '')

    if (
      !callback ||
      !Option.isSome(Schema.decodeUnknownOption(NativeCallbackScheme)(target.protocol)) ||
      target.protocol !== callback.protocol ||
      target.host !== callback.host ||
      target.pathname !== callback.pathname ||
      target.username ||
      target.password
    )
      return null

    return target.href
  }

  if (
    (target.origin === origin || target.origin === 'https://api.goosebumps.fm') &&
    ['/connect/gbfm', '/connect/gbfm/consent'].includes(target.pathname)
  )
    return `${target.pathname}${target.search}`

  return target.href
}

export const providerRedirect = async (
  response: Response,
  origin: string,
  query: string,
): Promise<typeof ProviderOutcome.Type> => {
  const location = await providerLocation(response, origin, query)

  return location
    ? ProviderOutcome.cases.Redirect.make({ location, cookies: response.headers.getSetCookie() })
    : ProviderOutcome.cases.Rejected.make({ status: response.ok ? 502 : response.status })
}
