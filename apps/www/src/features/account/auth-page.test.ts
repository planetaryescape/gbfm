import { HtmlServer } from '@effect/ui/html'
import { it, expect } from '@effect/vitest'
import { Effect } from 'effect'

import { AuthPage, safeAuthPageProps } from './auth-page'

it('reset POST fields retain the token without writing it into native server state', () =>
  Effect.gen(function* () {
    const rendered = yield* HtmlServer.renderToHtml(
      AuthPage,
      safeAuthPageProps({
        action: 'reset-password',
        url: 'https://example.test/auth/reset-password?token=disposable-reset-fixture',
      }),
    )

    expect(rendered.html).toContain('value="disposable-reset-fixture"')
    expect(JSON.stringify(rendered.state)).not.toContain('disposable-reset-fixture')
  }).pipe(Effect.scoped, Effect.runPromise))

it('auth forms retain native POST actions without putting passwords in component state', () =>
  Effect.gen(function* () {
    const { html } = yield* HtmlServer.renderToHtml(AuthPage, {
      action: 'sign-in',
      url: 'https://example.test/auth/sign-in?returnTo=%2Flistening',
    })

    expect(html).toContain('method="post"')
    expect(html).toContain('action="/auth/sign-in"')
    expect(html).toContain('name="returnTo"')
    expect(html).toContain('value="/listening"')
    expect(html).toContain('type="password"')
    expect(html).toContain('autocomplete="current-password"')
  }).pipe(Effect.scoped, Effect.runPromise))

it('expired reset links do not render a usable password form', () =>
  Effect.gen(function* () {
    const { html } = yield* HtmlServer.renderToHtml(AuthPage, {
      action: 'reset-password',
      url: 'https://example.test/auth/reset-password?error=token',
    })

    expect(html).toContain('Request a new link')
    expect(html).not.toContain('name="password"')
  }).pipe(Effect.scoped, Effect.runPromise))

it('verification success preserves the signed-in dashboard destination', () =>
  Effect.gen(function* () {
    const { html } = yield* HtmlServer.renderToHtml(AuthPage, {
      action: 'verify-email',
      url: 'https://example.test/auth/verify-email?verified=1',
    })

    expect(html).toContain('Email verified')
    expect(html).toContain('href="/dashboard"')
  }).pipe(Effect.scoped, Effect.runPromise))
