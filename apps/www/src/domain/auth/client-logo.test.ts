import { Option } from 'effect'
import { expect, it } from 'vitest'

import { clientLogoScript, clientLogoScriptHash, parseClientLogo } from './client-logo'

it('the standalone logo loader retains its exact CSP hash after extraction', async () => {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientLogoScript)),
  )

  expect(`sha256-${btoa(String.fromCharCode(...digest))}`).toBe(clientLogoScriptHash)
})

it('client logos remain restricted to public HTTPS origins without authority credentials', () => {
  expect(Option.isSome(parseClientLogo('https://images.valid-domain.com/logo.png'))).toBe(true)

  for (const value of [
    'http://images.valid-domain.com/logo.png',
    'https://localhost/logo.png',
    'https://127.0.0.1/logo.png',
    'https://user:fixture@images.valid-domain.com/logo.png',
  ])
    expect(Option.isNone(parseClientLogo(value))).toBe(true)
})
