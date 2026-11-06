import * as Server from 'foldkit/experimental/server'

import { consentFormActionSource } from './callback'
import { connectionErrorDocument } from './document'
import type { PendingContinuation } from './domain'

export const connectionResponse = (
  document: string,
  continuation?: PendingContinuation,
  status = 200,
) => {
  const callback = continuation ? consentFormActionSource({ continuation }) : null

  return Server.Responded(
    new Response(document, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
        'referrer-policy': 'strict-origin',
        'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'${callback ? ` ${callback}` : ''}; base-uri 'none'; frame-ancestors 'none'`,
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
