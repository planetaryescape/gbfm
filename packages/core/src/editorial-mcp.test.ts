import { Match, Option, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  canReadEditorial,
  EditorialAccount,
  EditorialOAuthConfiguration,
  EditorialOAuthSettings,
  EditorialPrincipal,
  EditorialReadScopes,
  EditorialScopes,
  McpScopes,
  canAuthorizeMcp,
  McpResourceUrl,
  OAuthClientId,
  PostVersion,
} from './editorial-mcp'

describe('editorial MCP domain boundaries', () => {
  test('expanded listener grants do not acquire editorial authority or implicit scopes', () => {
    const scopes = Schema.decodeUnknownSync(McpScopes)(['catalogue:read', 'offline_access'])
    const listener = Schema.decodeUnknownSync(EditorialAccount)({ role: 'user', banned: false })
    expect(canAuthorizeMcp(listener, scopes)).toBe(true)
    expect(canAuthorizeMcp(listener, ['posts:read'])).toBe(false)
    expect(canAuthorizeMcp(listener, ['catalogue:write'])).toBe(false)
    expect(
      canAuthorizeMcp(
        Schema.decodeUnknownSync(EditorialAccount)({ role: 'creator', banned: false }),
        ['catalogue:write'],
      ),
    ).toBe(false)
    expect(
      canAuthorizeMcp(
        Schema.decodeUnknownSync(EditorialAccount)({ role: 'admin', banned: false }),
        ['catalogue:write'],
      ),
    ).toBe(true)
    expect(canAuthorizeMcp({ ...listener, banned: true }, scopes)).toBe(false)

    for (const invalid of [
      [],
      ['offline_access'],
      ['drafts:write'],
      ['catalogue:read', 'catalogue:read'],
      ['unknown:read'],
    ]) {
      expect(Schema.decodeUnknownOption(McpScopes)(invalid)._tag).toBe('None')
    }

    expect(Schema.decodeUnknownOption(EditorialScopes)(scopes)._tag).toBe('None')
  })

  test.each(['creator', 'editor', 'admin'])(
    'allows an eligible %s without a configured identity',
    (role) => {
      const account = Schema.decodeUnknownSync(EditorialAccount)({ role, banned: false })
      expect(canReadEditorial(account)).toBe(true)
      expect(canReadEditorial({ ...account, banned: true })).toBe(false)
    },
  )

  test('does not grant editorial permission merely because a user is signed in', () => {
    expect(
      canReadEditorial(Schema.decodeUnknownSync(EditorialAccount)({ role: 'user', banned: false })),
    ).toBe(false)
  })
  test.each([
    'https://gbfm.localhost/mcp',
    'https://479-editorial-mcp.gbfm.localhost/mcp',
    'https://api.goosebumps.fm/mcp',
  ])('accepts configured local and production HTTPS resources: %s', (value) => {
    expect(Schema.decodeUnknownSync(McpResourceUrl)(value)).toBe(value)
  })

  test.each([
    'http://gbfm.localhost/mcp',
    'https://example.test/mcp?token=secret',
    'https://owner:password@example.test/mcp',
    'https://example.test/mcp#fragment',
    'https://example.test/mcp?',
    'https://example.test/mcp#',
    'https://example.test/not-mcp',
    'https://EXAMPLE.test/mcp',
  ])('rejects unsafe or noncanonical resource identities: %s', (value) => {
    expect(Option.isNone(Schema.decodeUnknownOption(McpResourceUrl)(value))).toBe(true)
  })

  test('requires the issuer and resource to belong to the same configured origin', () => {
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(EditorialOAuthSettings)({
          resourceUrl: 'https://gbfm.localhost/mcp',
          issuer: 'https://api.goosebumps.fm/auth',
        }),
      ),
    ).toBe(true)
  })

  test.each(['', 'client with spaces', 'client\nheader'])('rejects invalid client IDs', (value) => {
    expect(Option.isNone(Schema.decodeUnknownOption(OAuthClientId)(value))).toBe(true)
  })

  test.each([
    { scopes: ['offline_access'] },
    { scopes: ['posts:read', 'posts:publish'] },
    { scopes: ['posts:read', 'posts:read'] },
    { scopes: ['drafts:write'] },
    { scopes: ['posts:read', 'drafts:write', 'drafts:write'] },
  ])('rejects a principal without a valid editorial permission grant: %j', ({ scopes }) => {
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(EditorialPrincipal)({
          userId: 'owner',
          clientId: 'client',
          scopes,
        }),
      ),
    ).toBe(true)
  })

  test('draft-write is a separate permission and does not widen read-only contracts', () => {
    const write = ['posts:read', 'offline_access', 'drafts:write']
    expect(Schema.decodeUnknownSync(EditorialScopes)(write)).toEqual(write)
    expect(Option.isNone(Schema.decodeUnknownOption(EditorialReadScopes)(write))).toBe(true)
    expect(Schema.decodeUnknownSync(EditorialScopes)(['posts:read'])).toEqual(['posts:read'])
  })

  test('a post version cannot be confused with an arbitrary timestamp', () => {
    expect(Option.isNone(Schema.decodeUnknownOption(PostVersion)('2026-11-04T12:00:00Z'))).toBe(
      true,
    )
    expect(Schema.decodeUnknownSync(PostVersion)(`sha256:${'a'.repeat(64)}`)).toBe(
      `sha256:${'a'.repeat(64)}`,
    )
  })

  test('configuration variants require settings only in the enabled state', () => {
    const decode = Schema.decodeUnknownSync(EditorialOAuthConfiguration)

    const describe = Match.type<typeof EditorialOAuthConfiguration.Type>().pipe(
      Match.tag('Disabled', () => 'disabled'),
      Match.tag('Enabled', ({ settings }) => settings.resourceUrl),
      Match.exhaustive,
    )

    expect(describe(decode(EditorialOAuthConfiguration.cases.Disabled.make({})))).toBe('disabled')
    expect(
      describe(
        decode(
          EditorialOAuthConfiguration.cases.Enabled.make({
            settings: Schema.decodeUnknownSync(EditorialOAuthSettings)({
              resourceUrl: 'https://gbfm.localhost/mcp',
              issuer: 'https://gbfm.localhost/auth',
            }),
          }),
        ),
      ),
    ).toBe('https://gbfm.localhost/mcp')
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(EditorialOAuthConfiguration)(JSON.parse('{"_tag":"Enabled"}')),
      ),
    ).toBe(true)
  })
})
