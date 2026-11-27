import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Predicate } from 'effect'
import { describe, expect, it } from 'vitest'

import { AppRoute } from '../../app/route'
import { RoutedApplicationMessage, RoutedApplicationNoDeps } from '../../app/routed-application'
import { loadDashboardData } from '../../page/dashboard/page-data'
import { Route } from '../../route'
import { runWithLayer } from '../player/testing'
import { emptyDocument } from './document'
import { dashboardRootFixture, verifiedActor } from './page-root.test-support'

describe('actual Root dashboard documentless page contract', () => {
  it.each([200, 403])(
    'renders a creator administrator denial at page status %s through the real loader and Root without fetching private admin data',
    async (status) => {
      const principal = { id: 'creator-fixture', name: null, username: null, role: 'creator' }
      const url = new URL('/dashboard/users', 'https://fixture.test')
      const route = Route.cases.Dashboard.make({ section: 'users' })
      const requests: Array<string> = []

      const dashboard = await loadDashboardData(
        new Request(url),
        route,
        url,
        principal,
        async (_request, path) => {
          requests.push(path)
          throw new Error('Denied administrator fetch')
        },
      )

      const fixture = dashboardRootFixture(url.pathname, {
        principal,
        principalKnown: true,
        status,
        failure: null,
        dashboard,
      })

      await runWithLayer(
        fixture.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          expect(
            root.query(Locator.text('Administrator access required', { exact: true }))?.tag,
          ).toBe('h1')
          expect(root.text()).not.toContain('Dashboard data is unavailable.')
          expect(root.query(Locator.attr('aria-label', 'User accounts'))).toBeUndefined()
          expect(root.query(Locator.text('Create account', { exact: true }))).toBeUndefined()
          expect(requests).toEqual([])
          expect(fixture.apiRequests).toEqual([])
        }),
      )
    },
  )

  it.each(['user', 'creator', 'admin'])(
    'renders global Spotify connection controls for a verified %s without a dashboard payload',
    async (role) => {
      const fixture = dashboardRootFixture('/dashboard/integrations', {
        ...verifiedActor,
        principal: { id: 'owner-a', name: 'Fixture owner', username: 'fixture-owner', role },
      })

      await runWithLayer(
        fixture.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          const connect = root.get(Locator.text('Connect Spotify', { exact: true }))
          expect(Predicate.isTagged(connect, 'Element')).toBe(true)

          if (Predicate.isTagged(connect, 'Element')) expect(connect.attrs.disabled).toBeUndefined()
          expect(root.query(Locator.text('Refresh Spotify status', { exact: true }))).toBeDefined()
          expect(root.text()).not.toContain('Dashboard data is unavailable.')
          expect(fixture.requests[0]?.identity).toMatchObject({
            principalId: 'owner-a',
            known: true,
          })
          expect(fixture.apiRequests).toEqual([])
        }),
      )
    },
  )

  it.each(['/spotify/callback', '/dashboard/spotify-callback'])(
    'leaves %s owned by the secured standalone callback entry instead of the Root page query',
    (path) => {
      expect(AppRoute.parse(path)._tag).toBe('None')
    },
  )

  it.each([
    { path: '/dashboard/api-keys', expected: 'Creator access is required to create API keys.' },
    { path: '/dashboard/player', expected: 'Continue through queue' },
    { path: '/dashboard/appearance', expected: 'system' },
    {
      path: '/dashboard/sessions',
      expected: 'Search for an account to inspect and revoke its sessions.',
    },
    { path: '/dashboard/search', expected: 'Nothing here yet.' },
  ])('accepts only the established documentless contract at $path', async ({ path, expected }) => {
    const fixture = dashboardRootFixture(path, {
      ...verifiedActor,
      principal: {
        id: 'owner-a',
        name: 'Fixture owner',
        username: 'fixture-owner',
        role: path.includes('api-keys') ? 'user' : 'admin',
      },
    })

    await runWithLayer(
      fixture.layer,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(root.text()).toContain(expected)
        expect(root.text()).not.toContain('Dashboard data is unavailable.')
        expect(fixture.apiRequests).toEqual([])
      }),
    )
  })

  it.each([
    '/dashboard/profile',
    '/dashboard/email',
    '/dashboard/music',
    '/dashboard/search?q=fixture',
    '/dashboard/unknown-section',
  ])('does not turn a missing private payload into a valid page at %s', async (path) => {
    const fixture = dashboardRootFixture(path, {
      ...verifiedActor,
      principal: { id: 'owner-a', name: null, username: null, role: 'admin' },
    })

    await runWithLayer(
      fixture.layer,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(root.text()).toContain('Dashboard data is unavailable.')
        expect(root.query(Locator.text('Connect Spotify', { exact: true }))).toBeUndefined()
        expect(root.query(Locator.attr('name', 'username'))).toBeUndefined()
        expect(fixture.apiRequests).toEqual([])
      }),
    )
  })

  it.each([
    { principalKnown: false, status: 200, failure: null },
    { principalKnown: undefined, status: 200, failure: null },
    { principalKnown: true, status: 403, failure: null },
    { principalKnown: true, status: 503, failure: null },
    { principalKnown: true, status: 200, failure: 'Fixture private page failed' },
  ])('does not mount documentless controls for an unknown or failed page: %j', async (state) => {
    const fixture = dashboardRootFixture('/dashboard/integrations', { ...verifiedActor, ...state })
    await runWithLayer(
      fixture.layer,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(root.query(Locator.text('Connect Spotify', { exact: true }))).toBeUndefined()
        expect(root.query(Locator.text('Refresh Spotify status', { exact: true }))).toBeUndefined()
        expect(root.query(Locator.attr('role', 'alert'))).toBeDefined()
        expect(fixture.apiRequests).toEqual([])
      }),
    )
  })

  it.each(['/dashboard/sessions', '/dashboard/search'])(
    'preserves administrator guards on documentless %s',
    async (path) => {
      const fixture = dashboardRootFixture(path)
      await runWithLayer(
        fixture.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          expect(root.text()).toContain('Administrator access required.')
          expect(root.query(Locator.attr('aria-label', 'Search content'))).toBeUndefined()
          expect(fixture.apiRequests).toEqual([])
        }),
      )
    },
  )

  it('still renders a successfully loaded private dashboard document', async () => {
    const fixture = dashboardRootFixture('/dashboard/profile', {
      ...verifiedActor,
      dashboard: {
        ...emptyDocument,
        fields: { username: 'verified-profile', email: 'fixture@example.test', bio: '' },
      },
    })

    await runWithLayer(
      fixture.layer,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        const username = root.get(Locator.attr('name', 'username'))
        expect(Predicate.isTagged(username, 'Element')).toBe(true)

        if (Predicate.isTagged(username, 'Element'))
          expect(username.props.value).toBe('verified-profile')
        expect(root.text()).not.toContain('Dashboard data is unavailable.')
      }),
    )
  })

  it('gates a null dashboard payload through verified account changes, unknown identity and sign-out', async () => {
    const fixture = dashboardRootFixture('/dashboard/integrations')
    await runWithLayer(
      fixture.layer,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(root.query(Locator.text('Connect Spotify', { exact: true }))).toBeDefined()

        const next = {
          ...verifiedActor,
          principal: {
            id: 'owner-b',
            name: 'Second owner',
            username: 'second-owner',
            role: 'user',
          },
        }

        fixture.principalActor(next)
        root.send(RoutedApplicationMessage.ChangedAuthentication())
        yield* TestHost.settle
        expect(root.model()?.spotifyIdentity).toBe('owner-b')
        expect(root.query(Locator.text('Connect Spotify', { exact: true }))).toBeDefined()
        fixture.principalActor({ ...next, principalKnown: false })
        root.send(RoutedApplicationMessage.ChangedAuthentication())
        yield* TestHost.settle
        expect(root.query(Locator.text('Connect Spotify', { exact: true }))).toBeUndefined()
        fixture.principalActor({ ...verifiedActor, principal: null })
        root.send(RoutedApplicationMessage.ChangedAuthentication())
        yield* TestHost.settle
        expect(root.query(Locator.text('Connect Spotify', { exact: true }))).toBeUndefined()
        expect(root.query(Locator.attr('name', 'password'))).toBeDefined()
        expect(fixture.apiRequests).toEqual([])
      }),
    )
  })
})
