import type { Html } from '@effect/ui/html'

import { wordmark } from '../../ui/wordmark'

export const AuthShell = <M>(h: Html.H<M>) =>
  h.section
    .class('auth-page')
    .children(
      h.div.class('auth-backdrop').attr('aria-hidden', 'true').children(wordmark(h, 'full')),
    )
