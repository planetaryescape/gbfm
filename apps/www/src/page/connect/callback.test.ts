import { expect, it } from 'vitest'

import { consentFormActionSource } from './callback'
import { ConsentState, Continuation, parseContinuation } from './domain'

const verified = (callback: string) => {
  const params = new URLSearchParams({
    client_id: 'disposable-client',
    scope: 'posts:read',
    redirect_uri: callback,
    sig: 'disposable-signature',
    exp: '9999999999',
  })

  for (const key of [...params.keys(), 'ba_param']) params.append('ba_param', key)

  return Continuation.match(parseContinuation(params), {
    Missing: () => {
      throw new Error('Missing fixture continuation')
    },
    Rejected: () => {
      throw new Error('Rejected fixture continuation')
    },
    PendingVerification: (continuation) =>
      ConsentState.cases.Verified.make({
        continuation,
        clientName: 'Disposable app',
      }),
  })
}

it('allows only the verified HTTP callback host, port and path without query or fragment', () => {
  expect(consentFormActionSource(verified('http://127.0.0.1:38479/oauth-callback'))).toBe(
    'http://127.0.0.1:38479/oauth-callback',
  )
  expect(
    consentFormActionSource(verified('https://client.example.test/callback?app=disposable#done')),
  ).toBe('https://client.example.test/callback')
})

it('allows the specific native callback scheme, never a blanket protocol source', () => {
  expect(consentFormActionSource(verified('com.example.editor:/oauth/callback'))).toBe(
    'com.example.editor:',
  )
  expect(consentFormActionSource(verified('opencode://callback'))).toBe('opencode:')
})

it('rejects callback CSP injection, wildcards, credentials and executable browser schemes', () => {
  for (const callback of [
    'https://client.example.test/callback;form-action *',
    'https://client.example.test/callback;script-src',
    'https://client.example.test/callback,script-src',
    'https://client.example.test/callback\r\nX-Injected: yes',
    'https://*.example.test/callback',
    'https://client.example.test/*',
    'https://user:password@client.example.test/callback',
    'javascript:alert(1)',
    'data:text/html,disposable',
    'file:///disposable',
  ])
    expect(consentFormActionSource(verified(callback))).toBeNull()
})
