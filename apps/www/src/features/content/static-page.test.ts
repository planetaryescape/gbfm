import { HtmlServer } from '@effect/ui/html'
import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'

import { StaticPage } from '../../app/static-page'

it.effect('keeps the native About heading and all existing follow and legal destinations', () =>
  Effect.gen(function* () {
    const rendered = yield* HtmlServer.renderToHtml(StaticPage, { page: 'about', title: 'About' })

    assert.include(rendered.html, '<h1>About</h1>')

    for (const [href, label] of [
      ['/rss.xml', 'Mixes via RSS'],
      ['https://youtube.com/@goosebumpsfm', 'Mixes via YouTube'],
      ['/subscribe', 'Email updates'],
      ['/changelog', 'Changelog'],
      ['/privacy', 'Privacy policy'],
      ['/terms', 'Terms of service'],
    ]) {
      assert.include(rendered.html, `href="${href}"`)
      assert.include(rendered.html, label)
    }
  }),
)

it.effect('preserves every privacy clause in native server-rendered content', () =>
  Effect.gen(function* () {
    const rendered = yield* HtmlServer.renderToHtml(StaticPage, {
      page: 'privacy',
      title: 'Privacy Policy',
    })

    assert.include(rendered.html, '<h1>Privacy Policy</h1>')
    assert.include(
      rendered.html,
      'We store the minimum information needed to run goosebumps.fm: account information, activity you choose to create, and basic service analytics.',
    )
    assert.include(
      rendered.html,
      'We do not sell your personal information. Authentication cookies are used to keep you signed in, and operational analytics help us keep the service reliable.',
    )
    assert.include(
      rendered.html,
      'Contact us if you want to ask about, correct, or remove your account information.',
    )
  }),
)

it.effect('preserves every terms clause in native server-rendered content', () =>
  Effect.gen(function* () {
    const rendered = yield* HtmlServer.renderToHtml(StaticPage, {
      page: 'terms',
      title: 'Terms of Service',
    })

    assert.include(rendered.html, '<h1>Terms of Service</h1>')
    assert.include(
      rendered.html,
      'Use goosebumps.fm in good faith and respect the people whose work appears here.',
    )
    assert.include(
      rendered.html,
      'Do not scrape or abuse the service, impersonate another person, interfere with the service, or upload content you do not have permission to share.',
    )
    assert.include(
      rendered.html,
      'We may remove content or suspend accounts that violate these terms or put the service and its community at risk.',
    )
  }),
)

it.effect('preserves the static changelog heading and fallback paragraphs', () =>
  Effect.gen(function* () {
    const rendered = yield* HtmlServer.renderToHtml(StaticPage, {
      page: 'changelog',
      title: 'Changelog',
    })

    assert.include(rendered.html, '<h1>Changelog</h1>')
    assert.include(rendered.html, 'Latest release notes, updates and fixes from goosebumps.fm.')
    assert.include(rendered.html, 'Release history is published with each goosebumps.fm update.')
  }),
)
