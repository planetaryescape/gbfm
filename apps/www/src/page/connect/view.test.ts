import { EditorialScopes, McpScopes, OAuthClientId } from '@gbfm/core/editorial-mcp'
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

test.each([
  { scopes: ['catalogue:read'], expected: 'Read public music catalogue information' },
  {
    scopes: ['listening:write', 'listening:publish', 'reminders:write'],
    expected: 'including reminder emails to you',
  },
  {
    scopes: ['content:publish', 'content:delete', 'assets:upload'],
    expected: 'Delete your authored content',
  },
])(
  'expanded consent describes exact permissions, not implicit read-only or offline access: $scopes',
  ({ scopes, expected }) => {
    const html = consentDocument(
      ConsentState.cases.Verified.make({
        clientName: 'Local fixture app',
        account: { name: 'Local Listener', email: 'listener@example.test' },
        continuation: Continuation.cases.PendingVerification.make({
          clientId: OAuthClientId.make('fixture-client'),
          scopes: Schema.decodeUnknownSync(McpScopes)(scopes),
          query: SignedOAuthQuery.make(
            new URLSearchParams({ redirect_uri: 'http://127.0.0.1:38479/callback' }).toString(),
          ),
        }),
      }),
    )

    expect(html).toContain(expected)
    expect(html).toContain('New permissions require fresh consent.')
    expect(html).not.toContain('Read-only access')
    expect(html).not.toContain('Stay connected until you disconnect it')
    expect(html).not.toContain('Read your posts, including drafts')
    expect(html).not.toContain('undefined')
  },
)
