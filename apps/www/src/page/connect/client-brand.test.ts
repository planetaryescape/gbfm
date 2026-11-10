import { expect, test } from 'vitest'

import { identifyClientBrand } from './client-brand'
import { appIdentity } from './document'

test('uses bundled official artwork only for the supported website/logo metadata pair', () => {
  const brand = identifyClientBrand({
    client_uri: 'https://opencode.ai',
    logo_uri: 'https://opencode.ai/web-app-manifest-512x512.png',
  })

  const html = appIdentity('opencode', brand)
  expect(html).toContain('data-client-brand="opencode"')
  expect(html).toContain('viewBox="0 0 240 300"')
  expect(html).toContain('fill="#EEEEEE"')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('src="https://')
})

test.each([
  {},
  { client_uri: 'https://opencode.ai' },
  { logo_uri: 'https://opencode.ai/web-app-manifest-512x512.png' },
  {
    client_uri: 'https://opencode.ai.evil.test',
    logo_uri: 'https://opencode.ai/web-app-manifest-512x512.png',
  },
  { client_uri: 'https://opencode.ai', logo_uri: 'https://evil.test/logo.svg' },
  { client_uri: 'https://opencode.ai', logo_uri: 'javascript:alert(1)' },
])('retains the initial for unrecognized or incomplete metadata: %j', (client) => {
  const html = appIdentity('OpenCode', identifyClientBrand(client))
  expect(html).not.toContain('data-client-brand')
  expect(html).toContain('class="tile app">O</span>')
  expect(html).not.toContain('evil.test')
  expect(html).not.toContain('javascript:')
})

test('escapes initials from arbitrary client names', () => {
  expect(appIdentity('<script>')).toContain('class="tile app">&#60;</span>')
  expect(appIdentity('<script>')).not.toContain('<script>')
})
