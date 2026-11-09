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

const providerLocation = async (
  response: Response,
  origin: string,
  query: string,
  apiOrigin: string,
) => {
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
    (target.origin === origin || target.origin === apiOrigin) &&
    ['/connect/gbfm', '/connect/gbfm/consent'].includes(target.pathname)
  )
    return `${target.pathname}${target.search}`

  return target.href
}

export const providerRedirect = async (
  response: Response,
  origin: string,
  query: string,
  apiOrigin: string = URL.parse(response.url)?.origin ?? origin,
): Promise<typeof ProviderOutcome.Type> => {
  if (!response.ok) {
    const error = Option.getOrNull(
      Schema.decodeUnknownOption(
        Schema.Struct({
          error: Schema.String,
        }),
      )(
        await response
          .clone()
          .json()
          .catch(() => null),
      ),
    )

    if (error?.error === 'invalid_scope')
      return ProviderOutcome.cases.Rejected.make({ status: 409 })
  }

  const location = await providerLocation(response, origin, query, apiOrigin)

  return location
    ? ProviderOutcome.cases.Redirect.make({ location, cookies: response.headers.getSetCookie() })
    : ProviderOutcome.cases.Rejected.make({ status: response.ok ? 502 : response.status })
}
