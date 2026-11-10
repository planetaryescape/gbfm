import { Option } from 'effect'
import { expect, test } from 'vitest'

import { clientLogoScript, clientLogoScriptHash, parseClientLogo } from './client-logo'
import { appIdentity } from './document'
import { connectionResponse } from './response'

test.each([
  'https://opencode.ai/web-app-manifest-512x512.png',
  'https://assets.example.com/another-editor.png?size=64&theme=dark',
])('renders any supported client logo under an origin-specific CSP: %s', (url) => {
  const logo = Option.getOrUndefined(parseClientLogo(url))
  expect(logo).toBeDefined()
  const html = appIdentity('Any Editor', logo)
  expect(html).toContain('data-client-logo')
  expect(html).toContain('data-client-initial>A</span>')
  expect(html).toContain('referrerpolicy="no-referrer"')
  expect(html).not.toContain('data-client-brand')
  expect(html).not.toContain(' onerror=')

  const policy = connectionResponse(html, undefined, 200, logo).response.headers.get(
    'content-security-policy',
  )

  expect(policy).toContain(`img-src ${new URL(url).origin}`)
  expect(policy).toContain(`script-src '${clientLogoScriptHash}'`)
  expect(policy).toContain("default-src 'none'")
  expect(policy).toContain("frame-ancestors 'none'")
  expect(policy).not.toContain("script-src 'unsafe-inline'")
})

test.each([
  undefined,
  null,
  42,
  '',
  'http://assets.example.com/logo.png',
  'javascript:alert(1)',
  'data:image/svg+xml,<svg/>',
  '//assets.example.com/logo.png',
  'https://user:password@assets.example.com/logo.png',
  'https://127.0.0.1/logo.png',
  'https://127.1/logo.png',
  'https://2130706433/logo.png',
  'https://[::1]/logo.png',
  'https://localhost/logo.png',
  'https://app.localhost./logo.png',
  'https://app.internal/logo.png',
  'https://app.local/logo.png',
  'https://app.lan/logo.png',
  'https://app.example.test/logo.png',
  'https://printer/logo.png',
  'https://assets.example.com:8443/logo.png',
  'https://assets.example.com/logo.png#fragment',
  'https://assets.example.com;script-src/logo.png',
  'https://assets.example.com/' + 'a'.repeat(2048),
])('invalid or private logo metadata keeps a script-free initial fallback: %s', (value) => {
  const logo = Option.getOrUndefined(parseClientLogo(value))
  expect(logo).toBeUndefined()
  const html = appIdentity('OpenCode', logo)
  expect(html).toContain('data-client-initial>O</span>')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('<script')
  expect(connectionResponse(html).response.headers.get('content-security-policy')).not.toContain(
    'img-src',
  )
})

test('escapes names and URL attributes and pins the exact enhancement script', async () => {
  const html = appIdentity(
    '<script>',
    Option.getOrUndefined(parseClientLogo('https://assets.example.com/logo.png?a=1&b=2')),
  )

  expect(html).toContain('data-client-initial>&#60;</span>')
  expect(html).toContain('a=1&#38;b=2')

  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientLogoScript)),
  )

  expect(`sha256-${btoa(String.fromCharCode(...digest))}`).toBe(clientLogoScriptHash)
})
