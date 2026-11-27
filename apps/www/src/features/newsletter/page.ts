import { Html } from '@effect/ui/html'
import { Redacted, Schema } from 'effect'

import { Status } from '../../domain/auth/challenge'
import { HiddenField, StatusMessage, TextField } from '../account/fields'
import { FormToken, FormUrl, safeFormLocation } from '../account/safe-props'
import { AuthShell } from '../account/shell'
import { ChallengeMessage, SignupChallenge } from '../signup-challenge/mount'
import { ChallengeView } from '../signup-challenge/view'

export const safeNewsletterPageProps = (input: {
  mode: string
  url: string
  turnstileSiteKey?: string
}) => ({
  ...input,
  ...safeFormLocation(input.url),
})

export const NewsletterPage = Html.component({
  name: 'NewsletterPage',
  props: Schema.Struct({
    mode: Schema.String,
    url: FormUrl,
    token: FormToken,
    turnstileSiteKey: Schema.optional(Schema.String),
  }),
  model: Schema.Struct({ status: Status }),
  message: ChallengeMessage,
  restore: false,
}).make({
  init: () => ({ status: 'verifying' }),
  update: { ChangedChallengeStatus: ($, { status }) => $.evolve({ status }) },
  view: (h, model) => {
    const props = h.props
    const url = new URL(props.url, 'https://gbfm.local')
    const subscribing = props.mode === 'subscribe'
    const token = props.token ? Redacted.value(props.token) : null
    const complete = url.searchParams.get('complete')
    const sitekey = props.turnstileSiteKey ?? ''
    const title = subscribing ? 'Email updates' : 'Unsubscribe'

    const header = h.header
      .class('auth-header')
      .children(
        h.h1.children(title),
        h.p
          .class('auth-subtitle')
          .children(
            subscribing
              ? 'New mixes, notable drops, and occasional news from goosebumps.fm.'
              : 'Leave the mailing list at any time.',
          ),
      )

    if (complete) {
      let text = 'Check your inbox for an unsubscribe link.'

      if (subscribing) text = "You're subscribed."
      else if (complete === 'removed') text = "You've been removed from the mailing list."

      return AuthShell(h).children(
        h.div
          .class('auth-panel')
          .children(
            header,
            StatusMessage(h, text),
            h.a.attr('href', '/').children('Back to goosebumps.fm'),
          ),
      )
    }

    let form = h.form
      .class('auth-panel')
      .attr('method', 'post')
      .attr('action', `/actions/${props.mode}`)

    if (subscribing)
      form = form.onMount(SignupChallenge({ sitekey, action: 'newsletter-subscribe' }))
    let submit = 'Send link'

    if (subscribing) submit = 'Subscribe'
    else if (token) submit = 'Confirm unsubscribe'

    return AuthShell(h).children(
      form.children(
        header,
        token
          ? HiddenField(h, 'token', token)
          : h.div
              .class('auth-fields')
              .children(
                subscribing
                  ? TextField(h, { name: 'name', label: 'Name (optional)', required: false })
                  : null,
                TextField(h, { name: 'email', label: 'Email', type: 'email' }),
              ),
        subscribing ? ChallengeView(h, sitekey, model.status) : null,
        h.button
          .attr('type', 'submit')
          .class('auth-submit')
          .disabled(subscribing && (model.status !== 'ready' || !sitekey))
          .children(submit),
        h.p
          .class('auth-footer')
          .children(
            h.a
              .attr('href', subscribing ? '/unsubscribe' : '/subscribe')
              .children(subscribing ? 'Unsubscribe at any time' : 'Get email updates'),
          ),
      ),
    )
  },
})
