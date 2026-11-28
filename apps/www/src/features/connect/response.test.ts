import { expect, it } from 'vitest'

import { connectionResponse, connectionRedirect, withConnectionCookies } from './response'

it('native OAuth documents retain isolation, no-store and cookie-preserving HTTP contracts', () => {
  const page = connectionResponse('<h1>Connect</h1>')
  expect(page._tag).toBe('Responded')
  expect(page.response.headers.get('cache-control')).toBe('private, no-store')
  expect(page.response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  expect(page.response.headers.get('content-security-policy')).toContain("form-action 'self'")

  const redirect = withConnectionCookies(
    connectionRedirect('/dashboard', ['session=fixture; HttpOnly']),
    ['flow=fixture; HttpOnly'],
  )

  expect(redirect.response.status).toBe(303)
  expect(redirect.response.headers.get('location')).toBe('/dashboard')
  expect(redirect.response.headers.getSetCookie()).toEqual([
    'flow=fixture; HttpOnly',
    'session=fixture; HttpOnly',
  ])
})
