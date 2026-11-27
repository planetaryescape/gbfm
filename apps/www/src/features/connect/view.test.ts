import { McpScopes, OAuthClientId } from '@gbfm/core/editorial-mcp'
import { Schema } from 'effect'
import { expect, it } from 'vitest'

import { consentFormActionSource } from '../../domain/auth/callback'
import { ConsentState, Continuation, SignedOAuthQuery } from '../../domain/auth/connect'
import { consentDocument as legacyConsentDocument } from '../../page/connect/view'
import { connectionLoginDocument } from './login'
import { consentDocument } from './view'

const continuation = Continuation.cases.PendingVerification.make({
  clientId: OAuthClientId.make('fixture-client'),
  scopes: ['listening:read', 'listening:write'],
  query: SignedOAuthQuery.make(
    new URLSearchParams({
      redirect_uri: 'http://127.0.0.1:38479/callback',
      state: 'fixture&state',
    }).toString(),
  ),
})

it('standalone consent keeps exact scopes, escaped identity and native allow/deny/account POST forms', () => {
  const html = consentDocument(
    ConsentState.cases.Verified.make({
      continuation,
      clientName: '<script>untrusted</script>',
      account: { name: '<Listener>', email: 'fixture@example.test' },
    }),
  )

  expect(html).toContain('Read your saved listening, collections and private notes')
  expect(html).toContain('New permissions require fresh consent.')
  expect(html).not.toContain('Read-only access')
  expect(html).not.toContain('<script>untrusted</script>')
  expect(html).toContain('&#60;Listener&#62;')
  expect(html).toContain('action="/connect/gbfm/consent"')
  expect(html).toContain('name="decision" value="allow"')
  expect(html).toContain('name="decision" value="deny"')
  expect(html).toContain('action="/connect/gbfm/account"')
  expect(consentFormActionSource({ continuation })).toBe('http://127.0.0.1:38479/callback')
})

it('standalone connection sign-in uses a native password POST and keeps signed continuation hidden', () => {
  const html = connectionLoginDocument({
    continuation,
    clientName: 'Fixture app',
    email: '<user>@example.test',
  })

  expect(html).toContain('action="/connect/gbfm/sign-in"')
  expect(html).toContain('name="oauth_query"')
  expect(html).toContain('type="password" name="password" autocomplete="current-password"')
  expect(html).toContain('value="&#60;user&#62;@example.test"')
  expect(html).toContain('action="/connect/gbfm/cancel"')
  expect(html).not.toContain('gbfm-ui-state')
})

it.each([false, true])(
  'editorial consent preserves legacy private-artwork boundaries: %s',
  (writes) => {
    const state = ConsentState.cases.Verified.make({
      continuation: {
        ...continuation,
        scopes: Schema.decodeUnknownSync(McpScopes)(
          writes
            ? ['posts:read', 'drafts:write', 'offline_access']
            : ['posts:read', 'offline_access'],
        ),
      },
      clientName: 'Fixture app',
      account: { name: 'Local Editor', email: 'editor@example.test' },
    })

    for (const html of [consentDocument(state), legacyConsentDocument(state)]) {
      expect(
        html.includes(
          'Create and edit your own unpublished editorial drafts, including private artwork',
        ),
      ).toBe(writes)
      expect(html.includes('Cannot publish, delete or edit published posts.')).toBe(writes)
      expect(html.includes('Cannot create, edit, publish or delete.')).toBe(!writes)
      expect(html).not.toContain('Cannot publish, delete, upload files or edit published posts.')
      expect(html).not.toContain('Upload files for your authorized content')
      expect(html).not.toContain('Publish or unpublish your authored content')
      expect(html).not.toContain('Delete your authored content')
    }
  },
)

it('generic upload permission appears only in the explicitly requested scope union', () => {
  const html = consentDocument(
    ConsentState.cases.Verified.make({
      continuation: {
        ...continuation,
        scopes: Schema.decodeUnknownSync(McpScopes)([
          'posts:read',
          'drafts:write',
          'assets:upload',
        ]),
      },
      clientName: 'Fixture app',
      account: { name: 'Local Editor', email: 'editor@example.test' },
    }),
  )

  expect(html).toContain('including private artwork')
  expect(html).toContain('Upload files for your authorized content')
  expect(html).toContain('New permissions require fresh consent.')
  expect(html).not.toContain('Publish or unpublish your authored content')
  expect(html).not.toContain('Delete your authored content')
})
