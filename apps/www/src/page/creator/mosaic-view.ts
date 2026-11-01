import type { HtmlBuilder } from 'foldkit/html'

import { imageSource } from '../../view/artwork'
import { Message } from './message'
import { MosaicState, type Model } from './model'
import { mosaicSource } from './mosaic'

export const mosaicView = (model: Model, h: HtmlBuilder<Message>, busy: boolean) => {
  const mosaic = model.mosaic
  const generating = MosaicState.guards.Generating(mosaic)

  return h.div(
    [h.Class('creator-mosaic'), h.AriaBusy(generating)],
    [
      h.strong([], ['Mosaic artwork']),
      h.p(
        [],
        [
          'Automatically arrange up to four images from this post. Saved artwork stays fixed until you replace it.',
        ],
      ),
      h.button(
        [
          h.Type('button'),
          h.Class('btn btn-sm'),
          h.Disabled(busy || generating),
          h.OnClick(Message.MosaicRequested()),
        ],
        [
          generating
            ? 'Generating…'
            : model.draft.thumbnailUrl.includes('mosaic-') || MosaicState.guards.Ready(mosaic)
              ? 'Regenerate mosaic'
              : 'Generate mosaic',
        ],
      ),
      generating ? h.p([h.Role('status')], ['Finding artwork and building your mosaic…']) : h.empty,
      MosaicState.guards.Failed(mosaic) ? h.p([h.Role('alert')], [mosaic.message]) : h.empty,
      MosaicState.guards.Ready(mosaic)
        ? h.div(
            [],
            [
              h.img([
                imageSource(mosaic.url),
                h.Alt('Generated mosaic preview'),
                h.Width('1200'),
                h.Height('1200'),
              ]),
              mosaic.content !== mosaicSource(model.draft)
                ? h.p(
                    [h.Role('status')],
                    [
                      'This preview uses an earlier version of your post. Regenerate to include your latest edits.',
                    ],
                  )
                : h.empty,
              h.button(
                [
                  h.Type('button'),
                  h.Class('btn btn-sm'),
                  h.Disabled(busy),
                  h.OnClick(Message.MosaicAccepted()),
                ],
                ['Use mosaic'],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.Class('btn btn-sm'),
                  h.Disabled(busy),
                  h.OnClick(Message.MosaicDismissed()),
                ],
                ['Keep existing artwork'],
              ),
            ],
          )
        : h.empty,
    ],
  )
}
