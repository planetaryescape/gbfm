import type { Html } from '@effect/ui/html'

import type { Status } from '../../domain/auth/challenge'

export const ChallengeView = <M>(h: Html.H<M>, sitekey: string, status: Status) =>
  h.div
    .class('auth-challenge')
    .children(
      h.div.attr('data-turnstile', ''),
      h.p.attr('role', 'status').children(challengeStatus(sitekey, status)),
      (status === 'failed' || status === 'unavailable') && sitekey
        ? h.button
            .attr('type', 'button')
            .attr('data-challenge-retry', '')
            .children('Try verification again')
        : null,
      h.p.children('JavaScript is required to complete verification.'),
    )

const challengeStatus = (sitekey: string, status: Status) => {
  if (!sitekey || status === 'unavailable')
    return 'Verification is unavailable. Please try again later.'

  if (status === 'failed') return 'Verification failed. Please try again.'

  if (status === 'submitting') return 'Submitting…'

  if (status === 'ready') return 'Verification complete.'

  return 'Verifying…'
}
