import * as Server from 'foldkit/experimental/server'

import { consentFormActionSource } from './callback'
import { type ClientLogoUrl, clientLogoScriptHash } from './client-logo'
import { connectionErrorDocument } from './document'
import type { PendingContinuation } from './domain'

export const connectionResponse = (
  document: string,
  continuation?: PendingContinuation,
  status = 200,
  logo?: ClientLogoUrl,
) => {
  const callback = continuation ? consentFormActionSource({ continuation }) : null

  const logoPolicy = logo
    ? `; img-src ${new URL(logo).origin}; script-src '${clientLogoScriptHash}'`
    : ''

  return Server.Responded(
    new Response(document, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
        'referrer-policy': 'strict-origin',
        'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'${callback ? ` ${callback}` : ''}; base-uri 'none'; frame-ancestors 'none'${logoPolicy}`,
      },
    }),
  )
}

export const connectionFailure = (status: number, continuation?: PendingContinuation) =>
  connectionResponse(connectionErrorDocument(status, continuation), continuation, status)

export const connectionRedirect = (location: string, cookies: ReadonlyArray<string> = []) => {
  const headers = new Headers({
    location,
    'cache-control': 'private, no-store',
    'referrer-policy': 'no-referrer',
  })

  for (const cookie of cookies) headers.append('set-cookie', cookie)

  return Server.Responded(new Response(null, { status: 303, headers }))
}

export const withConnectionCookies = (result: Server.Responded, cookies: ReadonlyArray<string>) => {
  const headers = new Headers(result.response.headers)
  const finalCookies = headers.getSetCookie()
  headers.delete('set-cookie')

  for (const cookie of [...cookies, ...finalCookies]) headers.append('set-cookie', cookie)

  return Server.Responded(
    new Response(result.response.body, { status: result.response.status, headers }),
  )
}
