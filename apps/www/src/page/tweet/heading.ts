import { inertHtml as h } from 'foldkit/html'

import { breadcrumbs, crumbCurrent, crumbLink } from '../../view/breadcrumbs'
import { monthLabel, monthOf, relativeAge } from './timeline'

export const tweetHeading = (at: string, now: number) =>
  h.div(
    [h.Class('flex min-w-0 flex-1 min-h-11 items-center gap-3 text-xs')],
    [
      breadcrumbs([
        crumbLink({ label: 'Tweets', href: '/tweets' }),
        crumbCurrent(monthLabel(monthOf(at))),
      ]),
      h.span(
        [h.Class('ml-auto hidden shrink-0 text-muted-foreground md:block')],
        [relativeAge(at, now)],
      ),
    ],
  )
