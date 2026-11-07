import { EditorialScopes, OAuthClientId } from '@gbfm/core/editorial-mcp'
import { Schema } from 'effect'
import { expect, test } from 'vitest'

import { ConsentState, Continuation, SignedOAuthQuery } from './domain'
import { consentDocument } from './view'

test.each([false, true])('consent accurately describes draft-write permission: %s', (writes) => {
  const scopes = writes
    ? ['posts:read', 'offline_access', 'drafts:write']
    : ['posts:read', 'offline_access']

  const state = ConsentState.cases.Verified.make({
    clientName: 'OpenCode',
    account: { name: 'Test Editor', email: 'editor@example.test' },
    continuation: Continuation.cases.PendingVerification.make({
      clientId: OAuthClientId.make('fixture-client'),
      scopes: Schema.decodeUnknownSync(EditorialScopes)(scopes),
      query: SignedOAuthQuery.make(
        new URLSearchParams({ redirect_uri: 'http://127.0.0.1:38479/callback' }).toString(),
      ),
    }),
  })

  const html = consentDocument(state)
  expect(html).toContain('Read your posts, including drafts and private posts')

  expect(html.includes('Read and draft-write access')).toBe(writes)
  expect(html.includes('Create and edit your own unpublished editorial drafts')).toBe(writes)
  expect(html.includes('Cannot publish, delete, upload files or edit published posts.')).toBe(
    writes,
  )
  expect(html.includes('Read-only access')).toBe(!writes)
  expect(html.includes('Cannot create, edit, publish or delete.')).toBe(!writes)
})
