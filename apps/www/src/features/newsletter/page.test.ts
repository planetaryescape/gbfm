import { HtmlServer } from '@effect/ui/html'
import { it, expect } from '@effect/vitest'
import { Effect } from 'effect'

import { NewsletterPage, safeNewsletterPageProps } from './page'

it('unsubscribe confirmation remains a native POST with its token and no challenge', () =>
  Effect.gen(function* () {
    const { html } = yield* HtmlServer.renderToHtml(
      NewsletterPage,
      safeNewsletterPageProps({
        mode: 'unsubscribe',
        url: 'https://example.test/unsubscribe?token=disposable-fixture',
      }),
    )

    expect(html).toContain('action="/actions/unsubscribe"')
    expect(html).toContain('method="post"')
    expect(html).toContain('name="token"')
    expect(html).toContain('Confirm unsubscribe')
    expect(html).not.toContain('data-turnstile')
  }).pipe(Effect.scoped, Effect.runPromise))
