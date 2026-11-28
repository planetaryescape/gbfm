import { Locator, Scene } from '@effect/ui/testing'
import { assert, describe, it } from '@effect/vitest'
import { RichContentDocument } from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { Effect, Schema } from 'effect'

import type { PageDocument } from '../domain/page'
import { AuthPage, AuthPageProps } from '../features/account/auth-page'
import { PublicContentPage, PublicContentPageProps } from '../features/content'
import { CreatorPage } from '../features/creator/CreatorPage'
import { DashboardPage, DashboardPageProps } from '../features/dashboard'
import { emptyDocument } from '../features/dashboard/document'
import { InvitationPage } from '../features/invitation/page'
import { ListeningPage } from '../features/listening/page'
import { NewsletterPage } from '../features/newsletter/page'
import { ReaderPage, ReaderPageProps } from '../features/reader'
import { PageContent, PageContentEvents, ReaderContent, ReaderContentProps } from './page-content'
import { StaticPage } from './static-page'

const page = (url: string): PageDocument => ({
  url,
  status: 200,
  principal: null,
  principalKnown: true,
  items: [],
  title: 'Fixture page',
  description: '',
  requestId: 'page-composition-fixture',
  renderedAt: 1_794_000_000_000,
  skipSeen: false,
  tweet: null,
  neighbours: null,
  dashboard: null,
  profile: null,
  shows: null,
  changelog: null,
  publicAction: null,
  metadata: null,
  failure: null,
})

const principal = {
  id: 'fixture-editor',
  name: 'Fixture editor',
  username: 'fixture-editor',
  image: null,
  role: 'admin',
}

describe('PageContent route composition', () => {
  it.effect('composes every public content family from a relative page URL', () =>
    Effect.gen(function* () {
      const paths = [
        '/',
        '/mixes',
        '/mixes/mix',
        '/tracks',
        '/tracks/track',
        '/shows',
        '/shows/show',
        '/editorial',
        '/editorial/post',
        '/labels',
        '/labels/label',
        '/releases',
        '/releases/release',
        '/tags',
        '/tags/ambient',
        '/djs',
        '/djs/resident',
        '/collections',
        '/collections/collection',
        '/profile/resident',
        '/resident',
      ]

      for (const path of paths) {
        const scene = yield* Scene.make(PageContent, { page: page(path) })
        const child = Scene.children(scene.view, PublicContentPage)[0]
        assert.isDefined(child)
        const props = yield* Schema.decodeUnknownEffect(PublicContentPageProps)(child?.props)
        assert.strictEqual(new URL(props.document.url).pathname, path)
      }
    }),
  )

  it.effect('keeps one reader identity across list and detail destinations', () =>
    Effect.gen(function* () {
      const scene = yield* Scene.make(PageContent, {
        page: page('/tweets?q=ambient'),
        navigationId: 2,
        navigationAction: 'push',
      })

      const frame = Scene.children(scene.view, ReaderContent)[0]

      const reader = yield* Scene.make(
        ReaderContent,
        yield* Schema.decodeUnknownEffect(ReaderContentProps)(frame?.props),
      )

      const list = Scene.children(reader.view, ReaderPage)[0]
      assert.isDefined(list)
      const initial = yield* Schema.decodeUnknownEffect(ReaderPageProps)(list?.props)
      assert.strictEqual(initial.url.searchParams.get('q'), 'ambient')
      assert.strictEqual(initial.navigationId, 2)
      scene.props({
        page: { ...page('/tweet/missing'), status: 404 },
        navigationId: 3,
        navigationAction: 'pop',
      })
      const nextFrame = Scene.children(scene.view, ReaderContent)[0]
      assert.strictEqual(frame?.key, nextFrame?.key)
      reader.props(yield* Schema.decodeUnknownEffect(ReaderContentProps)(nextFrame?.props))
      const detail = Scene.children(reader.view, ReaderPage)[0]
      assert.isDefined(detail)
      assert.strictEqual(detail?.key, list?.key)
      const next = yield* Schema.decodeUnknownEffect(ReaderPageProps)(detail?.props)
      assert.strictEqual(next.status, 404)
      assert.strictEqual(next.navigationAction, 'pop')
    }),
  )

  it.effect('uses the native auth, newsletter, invitation, and static pages', () =>
    Effect.gen(function* () {
      for (const action of [
        'sign-in',
        'sign-up',
        'forgot-password',
        'reset-password',
        'verify-email',
      ]) {
        const scene = yield* Scene.make(PageContent, { page: page(`/auth/${action}`) })
        assert.strictEqual(Scene.children(scene.view, AuthPage).length, 1)
      }

      for (const name of ['subscribe', 'unsubscribe']) {
        const scene = yield* Scene.make(PageContent, { page: page(`/${name}`) })
        assert.strictEqual(Scene.children(scene.view, NewsletterPage).length, 1)
      }

      for (const name of ['about', 'privacy', 'terms']) {
        const scene = yield* Scene.make(PageContent, { page: page(`/${name}`) })
        assert.strictEqual(Scene.children(scene.view, StaticPage).length, 1)
      }

      const invitation = yield* Scene.make(PageContent, { page: page('/invite/charlie3000') })
      assert.strictEqual(Scene.children(invitation.view, InvitationPage).length, 1)
    }),
  )

  it.effect('adapts dashboard aliases and passes real creator contracts', () =>
    Effect.gen(function* () {
      for (const { path, expected } of [
        { path: '/dashboard/profile', expected: '/dashboard/profile' },
        { path: '/reminders', expected: '/dashboard/reminders' },
        { path: '/spotify/callback', expected: '/dashboard/spotify-callback' },
      ]) {
        const scene = yield* Scene.make(PageContent, {
          page: { ...page(path), principal, dashboard: emptyDocument },
        })

        const child = Scene.children(scene.view, DashboardPage)[0]
        assert.isDefined(child)
        const props = yield* Schema.decodeUnknownEffect(DashboardPageProps)(child?.props)
        assert.strictEqual(new URL(props.url).pathname, expected)
      }

      for (const path of ['/new', '/new/post', '/new/micro', '/mix-upload']) {
        const scene = yield* Scene.make(PageContent, { page: { ...page(path), principal } })
        assert.strictEqual(Scene.children(scene.view, CreatorPage).length, 1)
      }
    }),
  )

  it.effect('keeps listening collections and release notes in their native presentations', () =>
    Effect.gen(function* () {
      for (const path of ['/listening', '/collections', '/collections/fixture']) {
        const scene = yield* Scene.make(PageContent, {
          page: {
            ...page(path),
            listening: {
              workspace: path === '/listening',
              error: null,
              preview: null,
              document: { mixes: [], collections: [], memberships: [] },
            },
          },
        })

        assert.strictEqual(Scene.children(scene.view, ListeningPage).length, 1)
        assert.strictEqual(Scene.children(scene.view, PublicContentPage).length, 0)
      }

      const releaseNotes = yield* Schema.decodeUnknownEffect(RichContentDocument)(
        parseRichContent('Release fixture').document,
      )

      const changelog = yield* Scene.make(PageContent, {
        page: {
          ...page('/changelog'),
          changelog: releaseNotes,
        },
      })

      assert.isDefined(changelog.query(Locator.text('Release fixture', { exact: true })))
    }),
  )

  it.effect('preserves a sign-in form return destination for private pages', () =>
    Effect.gen(function* () {
      const scene = yield* Scene.make(PageContent, {
        page: page('/dashboard/profile?notice=saved'),
      })

      const child = Scene.children(scene.view, AuthPage)[0]
      assert.isDefined(child)
      const props = yield* Schema.decodeUnknownEffect(AuthPageProps)(child?.props)
      assert.strictEqual(props.action, 'sign-in')
      assert.strictEqual(
        new URL(props.url, 'https://goosebumps.fm').searchParams.get('returnTo'),
        '/dashboard/profile?notice=saved',
      )
    }),
  )

  it.effect('keeps readable errors and a no-JavaScript retry link with typed root intent', () =>
    Effect.gen(function* () {
      const scene = yield* Scene.make(PageContent, {
        page: { ...page('/dashboard'), principal, failure: 'Dashboard unavailable' },
      })

      const retry = Locator.text('Retry loading this page', { exact: true })
      assert.strictEqual(scene.get(retry).attrs?.href, '/dashboard')
      assert.isDefined(scene.query(Locator.text('Dashboard unavailable', { exact: true })))
      scene.click(retry).emitted(PageContentEvents.RequestedRefresh())
      assert.isTrue(scene.defaultPrevented)
    }),
  )

  it.effect('renders a real 404 instead of mounting an unrelated feature', () =>
    Effect.gen(function* () {
      const scene = yield* Scene.make(PageContent, {
        page: { ...page('/mixes/missing'), status: 404 },
      })

      assert.isDefined(scene.query(Locator.text('Page not found', { exact: true })))
      assert.strictEqual(Scene.children(scene.view, PublicContentPage).length, 0)
      assert.strictEqual(scene.get(Locator.text('Return home', { exact: true })).attrs?.href, '/')
    }),
  )
})
