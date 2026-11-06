import { Option, Schema } from 'effect'

import { apiRequest } from '../../server/api'
import { ConsentState, type PendingContinuation } from './domain'

const Client = Schema.Struct({ client_name: Schema.optional(Schema.String) })

const Session = Schema.Struct({
  user: Schema.Struct({ name: Schema.String, email: Schema.String }),
})

export const loadConnection = async (
  request: Request,
  continuation: PendingContinuation,
): Promise<typeof ConsentState.Type> => {
  const response = await apiRequest(request, '/auth/oauth2/public-client-prelogin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(request.url).origin },
    body: JSON.stringify({ client_id: continuation.clientId, oauth_query: continuation.query }),
  })

  if (!response.ok)
    return ConsentState.cases.Failed.make({
      status: response.status === 401 ? 400 : response.status,
    })

  const client = Option.getOrNull(
    Schema.decodeUnknownOption(Client)(await response.json().catch(() => null)),
  )

  if (!client) return ConsentState.cases.Failed.make({ status: 502 })
  const clientName = client.client_name || 'This app'
  const sessionResponse = await apiRequest(request, '/auth/get-session', { method: 'GET' })

  if (!sessionResponse.ok && sessionResponse.status !== 401)
    return ConsentState.cases.Failed.make({ status: sessionResponse.status })

  const payload = await sessionResponse.json().catch(() => undefined)

  if (payload === null || sessionResponse.status === 401)
    return ConsentState.cases.LoginRequired.make({ continuation, clientName })

  const session = Option.getOrNull(Schema.decodeUnknownOption(Session)(payload))

  return session
    ? ConsentState.cases.Verified.make({ continuation, clientName, account: session.user })
    : ConsentState.cases.Failed.make({ status: 502 })
}
