import type { Html, HtmlBuilder } from 'foldkit/html'

import { iconPaths, pixelIcon } from '../icons'

export const spotlightEnding = <Message>(
  h: HtmlBuilder<Message>,
  options: {
    readonly artwork?: Html
    readonly closing: ReadonlyArray<Html>
    readonly restart: Message
  },
) =>
  h.section(
    [h.Class('spotlight-end not-prose')],
    [
      ...(options.artwork ? [options.artwork] : []),
      h.div(
        [h.Class('spotlight-end-copy')],
        [
          h.h2([], ['Keep listening.']),
          ...options.closing,
          h.button(
            [
              h.Type('button'),
              h.Class('btn btn-quiet spotlight-restart'),
              h.OnClick(options.restart),
            ],
            [pixelIcon(iconPaths.chevronLeft, 'h-4 w-4'), 'Back to the beginning'],
          ),
        ],
      ),
    ],
  )
