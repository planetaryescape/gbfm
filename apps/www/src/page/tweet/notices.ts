import type { HtmlBuilder } from 'foldkit/html'

import { Message } from '../../message'
import type { Model } from '../../model'
import * as Reader from './reader'

const notice = (h: HtmlBuilder<Message>, text: string) =>
  h.p([h.Role('alert'), h.Class('mb-4 text-sm text-destructive')], [text])

export const readerNotices = (model: Model, h: HtmlBuilder<Message>, slug: string) => {
  const params = new URL(model.flags.url).searchParams
  const random = params.get('random')

  return h.div(
    [],
    [
      random
        ? notice(
            h,
            random === 'exhausted'
              ? 'Caught up. No unread tweets remain.'
              : 'Random unread is unavailable. Try again.',
          )
        : h.empty,
      params.get('reset') === 'failed'
        ? notice(h, 'Reading history could not be reset. Try again.')
        : h.empty,
      Reader.VisitState.guards.Failed(Reader.visitState(model.tweetReader, slug))
        ? h.div(
            [
              h.Role('alert'),
              h.Class('mb-4 flex flex-wrap items-center gap-2 text-sm text-destructive'),
            ],
            [
              'Reading history could not be saved.',
              h.button(
                [
                  h.Type('button'),
                  h.OnClick(Message.GotTweetReaderMessage({ message: Reader.Message.RetrySeen() })),
                  h.Class(
                    'inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs text-foreground hover:bg-muted',
                  ),
                ],
                ['Retry saving history'],
              ),
            ],
          )
        : h.empty,
    ],
  )
}
