import { HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { AuthPage } from '../account/auth-page'
import { ChallengeMessage, SignupChallenge } from './mount'

it('the signup form owns one challenge mount and enables submission only after readiness', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(AuthPage, {
      action: 'sign-up',
      url: 'https://example.test/auth/sign-up',
      turnstileSiteKey: 'fixture-site-key',
    })

    s.expectMount(SignupChallenge({ sitekey: 'fixture-site-key', action: 'account-signup' }))
    expect(s.get(Locator.attr('type', 'submit')).attrs?.disabled).toBe('')
    s.mounted(SignupChallenge, ChallengeMessage.ChangedChallengeStatus({ status: 'ready' }))
    expect(s.get(Locator.attr('type', 'submit')).attrs?.disabled).toBeUndefined()
  }).pipe(Effect.scoped, Effect.runPromise))
