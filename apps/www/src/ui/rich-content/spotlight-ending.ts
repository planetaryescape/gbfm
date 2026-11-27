import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { iconPaths, pixelIcon } from '../icons'

export const spotlightEnding = <Message, R = never>(
  h: Html.H<Message>,
  options: {
    readonly artwork?: View.Content<Message, R>
    readonly closing: ReadonlyArray<View.Content<Message, R>>
    readonly restart: Message
  },
) =>
  h.section.class('spotlight-end not-prose').children([
    ...(options.artwork ? [options.artwork] : []),
    h.div.class('spotlight-end-copy').children([
      h.h2.children(['Keep listening.']),
      ...options.closing,
      h.button
        .attr('type', 'button')
        .class('btn btn-quiet spotlight-restart')
        .on('click', options.restart)
        .children([pixelIcon(h, iconPaths.chevronLeft, 'h-4 w-4'), 'Back to the beginning']),
    ]),
  ])
