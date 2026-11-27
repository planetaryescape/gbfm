import { describe, expect, it } from 'vitest'

import { isPageUrl } from '../../app/route'
import { parseRoute, Route } from '../../route'
import { isSpotifyCallbackUrl } from './callback-url'

describe('native Spotify callback route privacy', () => {
  it.each(['/spotify/callback', '/dashboard/spotify-callback'])(
    'keeps %s credentials out of native page queries',
    (path) => {
      const url = new URL(
        `${path}?code=synthetic-callback-code&state=synthetic-callback-state`,
        'https://fixture.test',
      )

      expect(isPageUrl(url)).toBe(false)
    },
  )

  it('confirms the dashboard alias is currently a dashboard route, not the canonical static callback', () => {
    expect(parseRoute('/dashboard/spotify-callback')).toEqual(
      Route.cases.Dashboard.make({ section: 'spotify-callback' }),
    )
    expect(parseRoute('/spotify/callback')).toEqual(
      Route.cases.Static.make({ page: 'spotify-callback' }),
    )
  })

  it.each([
    '/spotify/callback',
    '/dashboard/spotify-callback',
    '/spotify/callback/',
    '/dashboard/spotify-callback/',
    '//dashboard//spotify-callback',
    '/dashboard/%73potify-callback',
  ])('classifies the existing callback route spelling %s without reading credentials', (path) => {
    const url = new URL('https://fixture.test')
    url.pathname = path
    url.search = '?code=synthetic-code&state=synthetic-state'
    expect(isSpotifyCallbackUrl(url)).toBe(true)
    const route = parseRoute(url.pathname)
    expect(Route.guards.Dashboard(route) || Route.guards.Static(route)).toBe(true)
  })

  it.each([
    '/dashboard/integrations',
    '/spotify/callback/other',
    '/dashboard/spotify-callback/other',
    '/auth/sign-in?returnTo=/dashboard/spotify-callback',
    '/dashboard/%ZZ',
  ])('does not classify another route as a callback: %s', (path) => {
    expect(isSpotifyCallbackUrl(new URL(path, 'https://fixture.test'))).toBe(false)
  })
})
