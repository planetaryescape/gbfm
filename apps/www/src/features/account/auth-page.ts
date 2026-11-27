import { UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Redacted, Schema } from 'effect'

import { Status } from '../../domain/auth/challenge'
import { authCopy } from '../../domain/auth/copy'
import { authErrorAction, authErrorMessage, parseAuthErrorKey } from '../../domain/auth/errors'
import { fieldStates, formFields } from '../../domain/auth/field-state'
import { authHref } from '../../domain/auth/links'
import { verificationState } from '../../domain/auth/verification'
import { SignupChallenge } from '../signup-challenge/mount'
import { ChallengeView } from '../signup-challenge/view'
import { HiddenField, StatusMessage, TextField } from './fields'
import { FormToken, FormUrl, safeFormLocation } from './safe-props'
import { AuthShell } from './shell'
import { TrackAuthSubmission } from './submission'

export const AuthPageProps = Schema.Struct({
  action: Schema.String,
  url: FormUrl,
  token: FormToken,
  turnstileSiteKey: Schema.optional(Schema.String),
})

export const safeAuthPageProps = (input: {
  action: string
  url: string
  turnstileSiteKey?: string
}) => ({
  ...input,
  ...safeFormLocation(input.url),
})

export const AuthPageMessage = UiSchema.TaggedEnum({
  ClickedPasswordReveal: {},
  ChangedChallengeStatus: { status: Status },
  SubmittedAuthForm: {},
  RestoredAuthForm: {},
})

export const AuthPage = Html.component({
  name: 'AuthPage',
  props: AuthPageProps,
  model: Schema.Struct({
    passwordVisible: Schema.Boolean,
    challengeStatus: Status,
    submitting: Schema.Boolean,
  }),
  message: AuthPageMessage,
  restore: false,
}).make({
  init: () => ({ passwordVisible: false, challengeStatus: 'verifying', submitting: false }),
  update: {
    ClickedPasswordReveal: ($) => $.evolve({ passwordVisible: !$.model.passwordVisible }),
    ChangedChallengeStatus: ($, { status }) => $.evolve({ challengeStatus: status }),
    SubmittedAuthForm: ($) => $.evolve({ submitting: true }),
    RestoredAuthForm: ($) => $.evolve({ submitting: false }),
  },
  view: (h, model) => {
    const props = h.props
    const url = new URL(props.url, 'https://gbfm.local')
    const token = props.token ? Redacted.value(props.token) : ''
    const action = props.action
    const returnTo = url.searchParams.get('returnTo') ?? ''
    const email = url.searchParams.get('email') ?? ''
    const errorKey = parseAuthErrorKey(url.searchParams.get('error'))
    const copy = authCopy(action)
    const link = (href: string, label: string) => h.a.attr('href', href).children(label)

    const notice = (title: string, subtitle: string, href: string, label: string) =>
      AuthShell(h).children(
        h.div
          .class('auth-panel')
          .children(h.h1.children(title), StatusMessage(h, subtitle), link(href, label)),
      )

    if (action === 'verify-email') {
      const state = verificationState(url)

      if (state === 'verified')
        return notice(
          'Email verified',
          "Your account is ready and you're signed in.",
          '/dashboard',
          'Go to your dashboard',
        )

      if (state === 'failed')
        return notice(
          'Verify your email',
          'This verification link has expired or was already used.',
          '/auth/sign-in',
          'Sign in',
        )

      return notice(
        'Check your email',
        'Use the verification link in your inbox to verify your account.',
        '/auth/sign-in',
        'Sign in',
      )
    }

    if (action === 'reset-password' && (!token || errorKey === 'token'))
      return notice(
        'Reset your password',
        'This link can no longer be used.',
        '/auth/forgot-password',
        'Request a new link',
      )

    if (action === 'forgot-password' && url.searchParams.has('sent'))
      return notice(
        'Check your email',
        'If an account exists for that email, a reset link is on its way.',
        authHref('/auth/forgot-password', { returnTo }),
        'Send another link',
      )
    const fields = formFields(action)
    const states = fieldStates(action, errorKey)
    const signup = action === 'sign-up'
    const sitekey = props.turnstileSiteKey ?? ''
    const error = authErrorMessage(errorKey)
    const errorAction = authErrorAction(errorKey)
    let form = h.form.class('auth-panel').attr('method', 'post').attr('action', `/auth/${action}`)

    if (signup) form = form.onMount(SignupChallenge({ sitekey, action: 'account-signup' }))
    else form = form.onMount(TrackAuthSubmission({}))

    return AuthShell(h).children(
      form.children(
        h.header
          .class('auth-header')
          .children(h.h1.children(copy.title), h.p.class('auth-subtitle').children(copy.subtitle)),
        error ? StatusMessage(h, error, true).attr('id', 'auth-error') : null,
        errorAction
          ? link(authHref(errorAction.path, { email, returnTo }), errorAction.label)
          : null,
        url.searchParams.has('reset')
          ? StatusMessage(h, 'Your password has been reset. Sign in with your new password.')
          : null,
        HiddenField(h, 'token', token),
        HiddenField(h, 'returnTo', returnTo),
        h.div.class('auth-fields').children(
          fields.includes('name')
            ? TextField(h, {
                name: 'name',
                label: 'Display name',
                value: url.searchParams.get('name') ?? '',
                ...states.name,
              })
            : null,
          fields.includes('email')
            ? TextField(h, {
                name: 'email',
                label: 'Email',
                type: 'email',
                value: email,
                ...states.email,
              })
            : null,
          fields.includes('password')
            ? h.div.class('auth-field').children(
                h.label.children(
                  h.span.class('auth-label').children('Password'),
                  h.input
                    .attr('id', 'auth-password')
                    .attr('name', 'password')
                    .attr('type', model.passwordVisible ? 'text' : 'password')
                    .attr('required', '')
                    .attr('minlength', action === 'sign-in' ? '1' : '8')
                    .attr('maxlength', action === 'sign-in' ? undefined : '128')
                    .attr('autocapitalize', 'off')
                    .attr('spellcheck', 'false')
                    .attr(
                      'autocomplete',
                      action === 'sign-in' ? 'current-password' : 'new-password',
                    )
                    .attr('aria-invalid', String(states.password.invalid))
                    .attr('aria-describedby', states.password.invalid ? 'auth-error' : undefined)
                    .attr('autofocus', states.password.focus ? '' : undefined),
                ),
                h.button
                  .attr('type', 'button')
                  .attr('aria-controls', 'auth-password')
                  .attr('aria-label', model.passwordVisible ? 'Hide password' : 'Show password')
                  .on('click', AuthPageMessage.ClickedPasswordReveal())
                  .children(model.passwordVisible ? 'Hide' : 'Show'),
                action === 'sign-in'
                  ? link(authHref('/auth/forgot-password', { returnTo }), 'Forgot password?')
                  : null,
              )
            : null,
        ),
        signup ? ChallengeView(h, sitekey, model.challengeStatus) : null,
        h.button
          .class('auth-submit')
          .attr('type', 'submit')
          .attr('aria-busy', String(model.submitting || model.challengeStatus === 'submitting'))
          .disabled(model.submitting || (signup && (model.challengeStatus !== 'ready' || !sitekey)))
          .children(copy.submit),
        h.p
          .class('auth-footer')
          .children(
            action === 'sign-in'
              ? link(authHref('/auth/sign-up', { returnTo }), 'Create an account')
              : link(authHref('/auth/sign-in', { returnTo }), 'Sign in'),
          ),
      ),
    )
  },
})
