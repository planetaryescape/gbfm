import { Component, Subscription, UiSchema } from '@effect/ui'
import { BrowserHost, Html } from '@effect/ui/html'
import { Effect, Fiber, Predicate, Queue, Schema, Stream } from 'effect'

import { ApiKeysMessage, IssueKey } from '../../src/features/dashboard/api-keys'
import { KeyServiceLive } from '../../src/page/dashboard/page/api-keys/service'

const FixtureMessage = UiSchema.TaggedEnum({
  PausedFixture: {},
  ResumedFixture: {},
})

const lifecycle = Stream.callback<typeof FixtureMessage.Type>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const pause = () => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        Queue.offerUnsafe(queue, FixtureMessage.PausedFixture())
      }

      const resume = () => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
        Queue.offerUnsafe(queue, FixtureMessage.ResumedFixture())
      }

      window.addEventListener('fixture:pause', pause)
      window.addEventListener('fixture:live', resume)

      return () => {
        window.removeEventListener('fixture:pause', pause)
        window.removeEventListener('fixture:live', resume)
      }
    }),
    (dispose) => Effect.sync(dispose),
  ),
)

const IssuanceFixture = Html.component({
  name: 'IssuanceFixture',
  model: Schema.Struct({
    passwordOpen: Schema.Boolean,
    verifying: Schema.Boolean,
    focusSecret: Schema.Boolean,
    failure: Schema.String,
    stage: Schema.String,
    viewState: Schema.Literals(['Live', 'Paused']),
    viewVersion: Schema.Number,
  }),
  message: Schema.Union([ApiKeysMessage, FixtureMessage]),
  restore: false,
})
  .make({
    init: () => ({
      passwordOpen: false,
      verifying: false,
      focusSecret: false,
      failure: '',
      stage: '',
      viewState: 'Live',
      viewVersion: 1,
    }),
    subscriptions: () => [Subscription.make('fixtureLifecycle', lifecycle)],
    update: ($, message) => {
      if (Predicate.isTagged(message, 'RequestedPassword'))
        return $.evolve({
          passwordOpen: true,
          focusSecret: false,
          failure: '',
          stage: 'PasswordRequested',
        })

      if (Predicate.isTagged(message, 'StartedVerification'))
        return $.evolve({ verifying: true, stage: 'PasswordVerificationStarted' })

      if (Predicate.isTagged(message, 'FailedVerification'))
        return $.evolve({
          verifying: false,
          failure: message.message,
          stage: 'PasswordVerificationFailed',
        })

      if (Predicate.isTagged(message, 'CancelledPassword'))
        return $.model.verifying || !$.model.passwordOpen
          ? $.model
          : $.evolve({ passwordOpen: false, stage: 'PasswordCancelled' })

      if (Predicate.isTagged(message, 'IssuedKey'))
        return $.evolve({
          passwordOpen: false,
          verifying: false,
          focusSecret: true,
          stage: 'Issued',
        })

      if (Predicate.isTagged(message, 'HiddenPage'))
        return $.evolve({ passwordOpen: false, focusSecret: false })

      if (Predicate.isTagged(message, 'PausedFixture'))
        return $.evolve({ viewState: 'Paused', viewVersion: $.model.viewVersion + 1 })

      if (Predicate.isTagged(message, 'ResumedFixture'))
        return $.evolve({ viewState: 'Live', viewVersion: $.model.viewVersion + 1 })

      return $.model
    },
    view: (h, model) =>
      h.section
        .attr('id', 'fixture')
        .attr('data-message', model.stage)
        .attr('data-failure', model.failure)
        .attr('data-view-state', model.viewState)
        .attr('data-view-version', String(model.viewVersion))
        .onMount(
          IssueKey({
            userId: 'owner',
            passwordOpen: model.passwordOpen,
            focusSecret: model.focusSecret,
            focusPassword: model.passwordOpen && !model.verifying && model.failure !== '',
          }),
        )
        .children(
          h.form.attr('data-key-create-form', '').children(
            h.input.attrs({
              name: 'name',
              'aria-label': 'Name',
              value: 'Disposable runtime fixture',
            }),
            h.input.attrs({ type: 'checkbox', name: 'scopes', value: 'posts:read', checked: '' }),
            h.input.attrs({ name: 'expiresInSeconds', value: '86400' }),
            h.button.attr('type', 'submit').disabled(true).children('Create key'),
          ),
          h.div.attr('data-key-secret', ''),
          h.p.attr('data-key-status', ''),
          h.dialog
            .attr('data-key-password-dialog', '')
            .modal(model.passwordOpen)
            .on('cancel', ApiKeysMessage.CancelledPassword(), { preventDefault: true })
            .on('close', ApiKeysMessage.CancelledPassword())
            .children(
              h.form
                .attr('data-key-password-form', '')
                .children(
                  h.input.attrs({ type: 'password', 'aria-label': 'Password' }),
                  h.button.attr('type', 'submit').children('Confirm'),
                ),
            ),
        ),
  })
  .pipe(Component.provide(KeyServiceLive))

export const mountIssuanceFixture = () => {
  const element = document.getElementById('fixture')

  if (!element) throw new Error('Missing fixture')
  element.removeAttribute('id')
  element.replaceChildren()

  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* BrowserHost.mountEffect(IssuanceFixture, {}, element)
        yield* Effect.never
      }),
    ),
  )

  const dispose = () => {
    window.removeEventListener('fixture:dispose', dispose)
    window.removeEventListener('pagehide', hidden)
    Effect.runFork(Fiber.interrupt(fiber))
  }

  const hidden = (event: PageTransitionEvent) => {
    if (!event.persisted) dispose()
  }

  window.addEventListener('fixture:dispose', dispose, { once: true })
  window.addEventListener('pagehide', hidden)
}
