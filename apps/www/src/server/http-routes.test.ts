import { expect, test } from 'vitest'

import { handlesHttpRequest } from './http-routes'

test.each([
  '/about?__data=1',
  '/api/music/releases.json',
  '/s/fixture',
  '/rss.xml',
  '/sitemap.xml',
  '/mcp.txt',
  '/auth/get-session',
  '/auth/oauth2/authorize?client_id=fixture',
  '/auth/verify-email?token=fixture',
  '/connect/gbfm',
  '/connect/gbfm/consent',
  '/telemetry/browser',
  '/social/cards/fixture.png',
  '/social/tweets/fixture.png',
  '/actions/mosaic',
])('the application owns its explicit HTTP endpoint %s', (path) => {
  expect(handlesHttpRequest(new Request(`https://fixture.test${path}`))).toBe(true)
})

test.each(['/about', '/privacy', '/terms', '/auth/sign-in', '/assets/missing.js', '/missing.png'])(
  'ordinary page/asset negotiation remains the host responsibility for %s',
  (path) => {
    expect(handlesHttpRequest(new Request(`https://fixture.test${path}`))).toBe(false)
  },
)

test.each([
  '/auth/sign-in',
  '/auth/sign-up',
  '/actions/listening/save',
  '/actions/admin/remove-user',
])('form endpoint %s is owned by the application on POST', (path) => {
  expect(handlesHttpRequest(new Request(`https://fixture.test${path}`, { method: 'POST' }))).toBe(
    true,
  )
})
