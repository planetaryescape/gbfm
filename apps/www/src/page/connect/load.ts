import { McpScope } from '@gbfm/core/editorial-mcp'
import { Option, Schema } from 'effect'

import { apiRequest } from '../../server/api'
import { identifyClientBrand } from './client-brand'
import { ConsentState, type PendingContinuation } from './domain'

const Client = Schema.Struct({
  client_name: Schema.optional(Schema.String),
  client_uri: Schema.optional(Schema.String),
  logo_uri: Schema.optional(Schema.String),
})

const Session = Schema.Struct({
  user: Schema.Struct({ name: Schema.String, email: Schema.String }),
})

export const loadConnection = async (
  request: Request,
  continuation: PendingContinuation,
): Promise<{
  readonly state: typeof ConsentState.Type
  readonly cookies: ReadonlyArray<string>
}> => {
  const [response, sessionResponse] = await Promise.all([
    apiRequest(request, '/auth/oauth2/public-client-prelogin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(request.url).origin },
      body: JSON.stringify({ client_id: continuation.clientId, oauth_query: continuation.query }),
    }),
    apiRequest(request, '/auth/get-session', { method: 'GET' }),
  ])

  const cookies = [...response.headers.getSetCookie(), ...sessionResponse.headers.getSetCookie()]

  if (!response.ok)
    return {
      state: ConsentState.cases.Failed.make({ status: response.status >= 500 ? 502 : 400 }),
      cookies,
    }

  const client = Option.getOrNull(
    Schema.decodeUnknownOption(Client)(await response.json().catch(() => null)),
  )

  if (!client) return { state: ConsentState.cases.Failed.make({ status: 502 }), cookies }
  const clientBrand = identifyClientBrand(client)
  const clientName = clientBrand === 'opencode' ? 'OpenCode' : client.client_name || 'This app'
  const identity = clientBrand ? { clientName, clientBrand } : { clientName }

  if (continuation.scopes.some((scope) => !['posts:read', 'offline_access'].includes(scope))) {
    const metadataResponse = await apiRequest(
      request,
      '/.well-known/oauth-protected-resource/mcp',
      {
        method: 'GET',
      },
    )

    const metadata = metadataResponse.ok
      ? Option.getOrNull(
          Schema.decodeUnknownOption(
            Schema.Struct({
              scopes_supported: Schema.Array(McpScope),
            }),
          )(await metadataResponse.json().catch(() => null)),
        )
      : null

    if (!metadata) return { state: ConsentState.cases.Failed.make({ status: 502 }), cookies }

    const blocked = continuation.scopes.filter(
      (scope) => scope !== 'offline_access' && !metadata.scopes_supported.includes(scope),
    )

    if (blocked.length)
      return {
        state: ConsentState.cases.PermissionsUnavailable.make({
          requested: continuation.scopes,
          available: metadata.scopes_supported,
          blocked,
        }),
        cookies,
      }
  }

  if (!sessionResponse.ok && sessionResponse.status !== 401)
    return { state: ConsentState.cases.Failed.make({ status: 502 }), cookies }

  const payload = await sessionResponse.json().catch(() => undefined)

  if (payload === null || sessionResponse.status === 401)
    return { state: ConsentState.cases.LoginRequired.make({ continuation, ...identity }), cookies }

  const session = Option.getOrNull(Schema.decodeUnknownOption(Session)(payload))

  return {
    state: session
      ? ConsentState.cases.Verified.make({ continuation, ...identity, account: session.user })
      : ConsentState.cases.Failed.make({ status: 502 }),
    cookies,
  }
}
