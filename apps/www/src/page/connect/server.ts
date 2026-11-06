import { Option, Schema } from 'effect'
import type * as Server from 'foldkit/experimental/server'

import { apiRequest } from '../../server/api'
import { authErrorKey, authErrorMessages, readAuthErrorCode } from '../auth/errors'
import { consentFormActionSource } from './callback'
import { providerRedirect } from './continuation'
import {
  ConsentState,
  Continuation,
  type PendingContinuation,
  parseContinuation,
  ProviderOutcome,
} from './domain'
import { loadConnection } from './load'
import { connectionLoginDocument } from './login'
import {
  connectionFailure as failure,
  connectionRedirect as redirect,
  connectionResponse,
  withConnectionCookies,
} from './response'
import { consentDocument } from './view'

const providerResponse = async (
  response: Response,
  url: URL,
  continuation: PendingContinuation,
  onLoginRedirect?: () => Server.Responded,
) =>
  ProviderOutcome.match(await providerRedirect(response, url.origin, continuation.query), {
    Redirect: ({ location, cookies }) =>
      onLoginRedirect && URL.parse(location, url.origin)?.pathname === '/connect/gbfm'
        ? withConnectionCookies(onLoginRedirect(), cookies)
        : redirect(location, cookies),
    Rejected: ({ status }) =>
      withConnectionCookies(failure(status, continuation), response.headers.getSetCookie()),
  })

const connectionPage = async (request: Request, continuation: PendingContinuation) => {
  const url = new URL(request.url)
  const { state, cookies } = await loadConnection(request, continuation)

  const result = await ConsentState.match<Promise<Server.Responded>>(state, {
    Failed: async ({ status }) => failure(status),
    LoginRequired: async (state) =>
      connectionResponse(connectionLoginDocument(state), continuation),
    Verified: async (state) => {
      if (!consentFormActionSource(state)) return failure(502)

      if (url.pathname === '/connect/gbfm/consent')
        return connectionResponse(consentDocument(state), continuation)

      const response = await apiRequest(request, '/auth/oauth2/continue', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          origin: url.origin,
        },
        body: JSON.stringify({ postLogin: true, oauth_query: continuation.query }),
      })

      return providerResponse(response, url, continuation, () =>
        connectionResponse(
          connectionLoginDocument({
            ...state,
            email: state.account.email,
            error: 'For this connection, the app requires you to sign in again.',
          }),
          continuation,
        ),
      )
    },
  })

  return withConnectionCookies(result, cookies)
}

const connectionAction = async (
  request: Request,
  continuation: PendingContinuation,
  form: FormData,
) => {
  const url = new URL(request.url)

  if (url.pathname === '/connect/gbfm/consent') {
    const decision = form.get('decision')

    if (decision !== 'allow' && decision !== 'deny') return failure(400)

    const response = await apiRequest(request, '/auth/oauth2/consent', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        origin: url.origin,
      },
      body: JSON.stringify({ accept: decision === 'allow', oauth_query: continuation.query }),
    })

    return providerResponse(response, url, continuation)
  }

  if (url.pathname === '/connect/gbfm/sign-in') return signIn(request, continuation, form)

  if (!['/connect/gbfm/account', '/connect/gbfm/cancel'].includes(url.pathname)) return failure(404)
  const { state, cookies } = await loadConnection(request, continuation)

  return withConnectionCookies(await actOnConnection(request, continuation, state), cookies)
}

const actOnConnection = async (
  request: Request,
  continuation: PendingContinuation,
  state: typeof ConsentState.Type,
) => {
  const url = new URL(request.url)

  if (ConsentState.guards.Failed(state)) return failure(state.status)

  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    origin: url.origin,
  }

  if (url.pathname === '/connect/gbfm/cancel') {
    const response = await apiRequest(request, '/.well-known/oauth-authorization-server/auth', {
      method: 'GET',
    })

    const metadata = Option.getOrNull(
      Schema.decodeUnknownOption(Schema.Struct({ issuer: Schema.String }))(
        await response.json().catch(() => null),
      ),
    )

    if (!response.ok || !metadata || !consentFormActionSource({ continuation })) return failure(502)
    const query = new URLSearchParams(continuation.query)
    const callback = new URL(query.get('redirect_uri') ?? '')
    callback.searchParams.set('error', 'access_denied')
    callback.searchParams.set('error_description', 'The user cancelled the connection')
    callback.searchParams.set('iss', metadata.issuer)
    const clientState = query.get('state')

    if (clientState) callback.searchParams.set('state', clientState)

    return redirect(callback.href)
  }

  if (url.pathname === '/connect/gbfm/account') {
    const response = await apiRequest(request, '/auth/sign-out', {
      method: 'POST',
      headers,
      body: '{}',
    })

    return response.ok
      ? redirect(`/connect/gbfm?${continuation.query}`, response.headers.getSetCookie())
      : failure(response.status)
  }

  return failure(404)
}

const signIn = async (request: Request, continuation: PendingContinuation, form: FormData) => {
  const url = new URL(request.url)

  const credentials = Option.getOrNull(
    Schema.decodeUnknownOption(Schema.Struct({ email: Schema.String, password: Schema.String }))({
      email: form.get('email'),
      password: form.get('password'),
    }),
  )

  if (!credentials) return failure(400)

  const response = await apiRequest(request, '/auth/sign-in/email', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', accept: 'application/json', origin: url.origin },
    body: JSON.stringify({ ...credentials, oauth_query: continuation.query }),
  })

  if (!response.ok) {
    if (response.status >= 500) return failure(response.status, continuation)
    const code = await readAuthErrorCode(response)

    if (response.status === 403 && code === 'EDITORIAL_PERMISSION_REQUIRED')
      return failure(403, continuation)
    const error = authErrorMessages[authErrorKey(response.status, code)]
    const { state, cookies } = await loadConnection(request, continuation)

    const result = ConsentState.guards.Failed(state)
      ? failure(state.status)
      : connectionResponse(
          connectionLoginDocument({ ...state, email: credentials.email, error }),
          continuation,
          response.status,
        )

    return withConnectionCookies(result, [...cookies, ...response.headers.getSetCookie()])
  }

  return providerResponse(response, url, continuation)
}

export const handleConnection = async (request: Request): Promise<Server.Responded> => {
  const url = new URL(request.url)

  if (!['GET', 'POST'].includes(request.method)) return failure(405)

  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) return failure(403)
  const form = request.method === 'POST' ? await request.formData().catch(() => null) : null

  const query = Option.getOrNull(
    Schema.decodeUnknownOption(Schema.String)(form?.get('oauth_query')),
  )

  if (request.method === 'POST' && query === null) return failure(400)

  return Continuation.match<Promise<Server.Responded>>(
    parseContinuation(query === null ? url.searchParams : new URLSearchParams(query)),
    {
      Missing: async () => failure(400),
      Rejected: async () => failure(400),
      PendingVerification: async (continuation) => {
        if (form) return connectionAction(request, continuation, form)

        if (!['/connect/gbfm', '/connect/gbfm/consent'].includes(url.pathname)) return failure(404)

        return connectionPage(request, continuation)
      },
    },
  )
}
