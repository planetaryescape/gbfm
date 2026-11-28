import { MessageLog } from '@effect/ui'
import { HtmlServer } from '@effect/ui/html'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import { Effect, Predicate } from 'effect'

import { publicMix, publicPage, PublicContentTestRoot } from './fixtures'
import { ContentListingPage } from './listing'

it.effect('keeps all listing kinds and tag links readable without JavaScript', () =>
  Effect.gen(function* () {
    for (const kind of ['mixes', 'tracks', 'releases', 'labels', 'djs', 'collections', 'tags']) {
      const rendered = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
        document: publicPage(`/${kind}`),
      })

      assert.include(rendered.html, 'Night Mix')
      assert.include(rendered.html, 'href="/mixes/night-mix"')

      if (kind !== 'tags') assert.include(rendered.html, '/gb-default-v1.webp')
    }
  }),
)

it.effect('renders the featured mix and browse-shows link on the server', () =>
  Effect.gen(function* () {
    const rendered = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: publicPage('/'),
    })

    assert.include(rendered.html, 'Featured')
    assert.include(rendered.html, 'Night Mix')
    assert.include(rendered.html, 'Host')
    assert.include(rendered.html, 'Play mix')
    assert.include(rendered.html, 'href="/shows"')
  }),
)

it.effect('preserves detail artwork, credits, platform links, tags and writing', () =>
  Effect.gen(function* () {
    const entries: Array<MessageLog.Entry> = []

    const rendered = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: publicPage('/mixes/night-mix'),
    }).pipe(
      Effect.provideService(MessageLog.MessageLog, {
        enabled: true,
        record: (entry) => entries.push(entry),
      }),
    )

    assert.deepStrictEqual(entries.filter(Predicate.isTagged('Failed')), [])
    assert.include(rendered.html, 'Night Mix')
    assert.include(rendered.html, 'href="/profile/host"')
    assert.include(rendered.html, 'href="/tags/ambient"')
    assert.include(rendered.html, 'https://example.bandcamp.com/album/night')
    assert.include(rendered.html, 'Listen closely.')
    assert.include(rendered.html, 'Get email updates')
    assert.include(rendered.html, 'Add to queue')
  }),
)

it.effect('shows private draft disclosure and the existing edit destination', () =>
  Effect.gen(function* () {
    const item = { ...publicMix, draft: true }

    const rendered = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: publicPage('/editorial/night-mix', [item]),
    })

    assert.include(rendered.html, 'Private draft')
    assert.include(rendered.html, 'Only you and your co-authors')
    assert.include(rendered.html, '/new/editorial?edit=night-mix')
  }),
)

it.effect('distinguishes empty tag results from read failures through the native scene', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(ContentListingPage, {
      title: 'Ambient',
      kind: 'tags',
      tagged: true,
      items: [],
      failure: null,
    })

    s.expect(Locator.text('No posts with this tag yet.')).toExist()

    const failed = yield* HtmlScene.make(ContentListingPage, {
      title: 'Ambient',
      kind: 'tags',
      tagged: true,
      items: [],
      failure: 'Try again later.',
    })

    failed.expect(HtmlLocator.role('alert')).toHaveText('Try again later.')
    failed.expect(Locator.text('No posts with this tag yet.')).toBeAbsent()
  }),
)

it.effect('renders a real not-found page rather than a missing detail placeholder', () =>
  Effect.gen(function* () {
    const rendered = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: { ...publicPage('/mixes/missing', []), status: 404 },
    })

    assert.include(rendered.html, 'Page not found')
    assert.include(rendered.html, 'Return home')
  }),
)

it.effect('preserves editorial draft visibility notices and deterministic recency labels', () =>
  Effect.gen(function* () {
    const draft = { ...publicMix, id: 'draft', draft: true, href: '/editorial/draft' }

    const result = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: publicPage('/editorial', [draft, { ...publicMix, href: '/editorial/published' }]),
    })

    assert.include(result.html, 'Your drafts are marked below.')
    assert.include(result.html, 'They are only visible to their authors.')
    assert.include(result.html, 'Draft')
    assert.include(result.html, 'href="/editorial/draft"')
    assert.include(result.html, 'href="/editorial/published"')
    assert.include(result.html, 'By ')
    assert.include(result.html, 'href="/profile/host"')
    assert.include(result.html, '>new<')
  }),
)

it.effect('does not render private content from a not-found page response', () =>
  Effect.gen(function* () {
    const result = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: {
        ...publicPage('/editorial/private', [
          { ...publicMix, title: 'Private writing', draft: true },
        ]),
        status: 404,
      },
    })

    assert.include(result.html, 'Page not found')
    assert.notInclude(result.html, 'Private writing')
    assert.notInclude(result.html, 'Listen closely.')
  }),
)

it.effect('holds private artwork inert until the exact-path preview grant is installed', () =>
  Effect.gen(function* () {
    const imageUrl = 'https://cdn.goosebumps.fm/user-content/private/draft/cover.webp'

    const result = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: publicPage('/editorial/private', [{ ...publicMix, draft: true, imageUrl }]),
    })

    assert.include(result.html, `data-private-media-src="${imageUrl}"`)
    assert.notInclude(result.html, ` src="${imageUrl}"`)
    assert.notInclude(result.html, 'srcset=')
  }),
)

it.effect('composes the real membership control with the existing sign-in return path', () =>
  Effect.gen(function* () {
    const result = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: {
        ...publicPage('/mixes/night-mix'),
        publicAction: {
          target: { id: publicMix.id, kind: 'audio' },
          path: '/mixes/night-mix',
          state: 'anonymous',
        },
      },
    })

    assert.include(result.html, '/auth/sign-in?returnTo=%2Fmixes%2Fnight-mix')
    assert.include(result.html, 'Sign in to favorite')
  }),
)
