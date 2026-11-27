import { expect, it } from '@effect/vitest'
import { getStaticSiteMetadata } from '@gbfm/site-metadata'
import { Schema } from 'effect'

import { makeSpotifyCallbackProps } from '../features/spotify/callback-application'
import { BootstrapJson, serializeBootstrap } from './bootstrap'
import { makeCredentialProps } from './credential-application'

const metadata = getStaticSiteMetadata('/about')

if (!metadata) throw new Error('Missing public metadata fixture')

it('preserves typed routed bootstrap data while escaping script terminators and separators', () => {
  const serialized = serializeBootstrap({
    kind: 'routed',
    url: new URL('https://goosebumps.fm/about'),
    metadata: { ...metadata, title: '</script>\u2028\u2029' },
    identity: { principalId: null, known: true, epoch: 0 },
    realm: 'fixture-request',
  })

  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(BootstrapJson))(serialized)

  expect(serialized).not.toMatch(/[<\u2028\u2029]/)
  expect(decoded.kind).toBe('routed')
  expect(decoded.metadata.title).toBe('</script>\u2028\u2029')
})

it('rejects credential-bearing routes in the ordinary routed bootstrap', () => {
  expect(() =>
    serializeBootstrap({
      kind: 'routed',
      url: new URL('https://goosebumps.fm/auth/reset-password?token=fixture-private'),
      metadata,
      identity: { principalId: null, known: true, epoch: 0 },
      realm: 'fixture-request',
    }),
  ).toThrow()
})

it('projects reset credentials out of the public bootstrap even when internal props are supplied', () => {
  const props = makeCredentialProps(
    'https://goosebumps.fm/auth/reset-password?token=fixture-private',
    metadata,
  )

  const serialized = serializeBootstrap({ kind: 'credential', ...props })
  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(BootstrapJson))(serialized)

  expect(decoded.kind).toBe('credential')
  expect(serialized).not.toContain('fixture-private')
  expect(serialized).not.toContain('"token"')
})

it('uses only the fixed public callback location and metadata', () => {
  const serialized = serializeBootstrap({
    kind: 'spotify-callback',
    ...makeSpotifyCallbackProps({ principal: null, principalKnown: true }),
  })

  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(BootstrapJson))(serialized)

  expect(decoded.kind).toBe('spotify-callback')
  expect(decoded.url).toBe('/spotify/callback')
  expect(serialized).not.toContain('code=')
  expect(serialized).not.toContain('state=')
})
