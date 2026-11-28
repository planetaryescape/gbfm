import { OAuthClientId } from '@gbfm/core/editorial-mcp'
import { expect, it } from 'vitest'

import { consentFormActionSource } from './callback'
import { Continuation, SignedOAuthQuery } from './connect'

const source = (redirectUri: string) =>
  consentFormActionSource({
    continuation: Continuation.cases.PendingVerification.make({
      clientId: OAuthClientId.make('fixture-client'),
      scopes: ['posts:read'],
      query: SignedOAuthQuery.make(new URLSearchParams({ redirect_uri: redirectUri }).toString()),
    }),
  })

it('callback CSP sources preserve exact HTTP paths and supported native protocols', () => {
  expect(source('http://127.0.0.1:38479/callback?state=fixture')).toBe(
    'http://127.0.0.1:38479/callback',
  )
  expect(source('goosebumps://callback')).toBe('goosebumps:')
})

it('callback CSP sources reject dangerous protocols, credentials and policy delimiters', () => {
  for (const uri of [
    'javascript:alert(1)',
    'data:text/html,fixture',
    'chrome://settings',
    'https://user:fixture@example.test/callback',
    'https://example.test/callback;script-src',
  ])
    expect(source(uri)).toBeNull()
})
