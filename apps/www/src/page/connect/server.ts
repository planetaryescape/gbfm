import { Option, Schema } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { apiRequest } from '../../server/api'
import { redirect } from '../../server/form-actions'
import { authHref } from '../auth/links'
import { consentFormActionSource } from './callback'
import { providerRedirect } from './continuation'
import {
  ConsentState,
  Continuation,
  type PendingContinuation,
  parseContinuation,
  ProviderOutcome,
} from './domain'
import { consentDocument } from './view'

const Client = Schema.Struct({ client_name: Schema.optional(Schema.String) })

const Decision = Schema.Struct({
  query: Schema.String,
  decision: Schema.Literals(['allow', 'deny']),
})

const failure = (status: number) =>
  Server.Responded(
    new Response('This connection could not be completed. Start again from your app.', {
      status,
      headers: { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' },
    }),
  )

const loadConsent = async (
  request: Request,
  continuation: PendingContinuation,
): Promise<typeof ConsentState.Type> => {
  const origin = new URL(request.url).origin

  const verified = await apiRequest(request, '/auth/oauth2/public-client-prelogin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ client_id: continuation.clientId, oauth_query: continuation.query }),
  })

  if (!verified.ok) return ConsentState.cases.Failed.make({ status: verified.status })

  const response = await apiRequest(
    request,
    `/auth/oauth2/public-client?${new URLSearchParams({ client_id: continuation.clientId })}`,
    { method: 'GET' },
  )

  if (response.status === 401) return ConsentState.cases.LoginRequired.make({ continuation })

  if (!response.ok) return ConsentState.cases.Failed.make({ status: response.status })

  const client = Option.getOrNull(
    Schema.decodeUnknownOption(Client)(await response.json().catch(() => null)),
  )

  return client
    ? ConsentState.cases.Verified.make({
        continuation,
        clientName: client.client_name || 'This app',
      })
    : ConsentState.cases.Failed.make({ status: 502 })
}

const consentPage = async (request: Request, continuation: PendingContinuation) =>
  ConsentState.match(await loadConsent(request, continuation), {
    Failed: ({ status }) => failure(status),
    LoginRequired: ({ continuation }) => redirect(`/connect/gbfm?${continuation.query}`),
    Verified: (state) => {
      const callbackSource = consentFormActionSource(state)

      if (!callbackSource) return failure(502)

      return Server.Responded(
        new Response(consentDocument(state), {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'private, no-store',
            'referrer-policy': 'strict-origin',
            'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callbackSource}; base-uri 'none'; frame-ancestors 'none'`,
          },
        }),
      )
    },
  })

const consentDecision = async (request: Request) => {
  const url = new URL(request.url)

  if (request.headers.get('origin') !== url.origin) return failure(403)
  const form = await request.formData().catch(() => null)

  if (!form) return failure(400)

  const input = Option.getOrNull(
    Schema.decodeUnknownOption(Decision)({
      query: form.get('oauth_query'),
      decision: form.get('decision'),
    }),
  )

  if (!input) return failure(400)

  return Continuation.match<Promise<Server.Responded>>(
    parseContinuation(new URLSearchParams(input.query)),
    {
      Missing: async () => failure(400),
      Rejected: async () => failure(400),
      PendingVerification: async (continuation) => {
        const response = await apiRequest(request, '/auth/oauth2/consent', {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            origin: url.origin,
          },
          body: JSON.stringify({
            accept: input.decision === 'allow',
            oauth_query: continuation.query,
          }),
        })

        return ProviderOutcome.match(
          await providerRedirect(response, url.origin, continuation.query),
          {
            Redirect: ({ location, cookies }) => redirect(location, cookies),
            Rejected: ({ status }) => failure(status),
          },
        )
      },
    },
  )
}

export const handleConnection = async (request: Request): Promise<Server.Responded> => {
  const url = new URL(request.url)

  if (url.pathname === '/connect/gbfm/consent' && request.method === 'POST')
    return consentDecision(request)

  if (!['/connect/gbfm', '/connect/gbfm/consent'].includes(url.pathname)) return failure(404)

  if (request.method !== 'GET') return failure(405)

  return Continuation.match<Promise<Server.Responded>>(parseContinuation(url.searchParams), {
    Missing: async () => failure(400),
    Rejected: async () => failure(400),
    PendingVerification: async (continuation) =>
      url.pathname === '/connect/gbfm'
        ? redirect(authHref('/auth/sign-in', { returnTo: `/connect/gbfm?${continuation.query}` }))
        : consentPage(request, continuation),
  })
}
