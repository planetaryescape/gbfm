import type { Html, HtmlBuilder } from 'foldkit/html'

import { iconPaths, lucide } from '../../view/icons'
import { Message } from './message'
import { showsBodyEditor, type Attachment, type Model } from './model'
import { titleField } from './title-view'

type Builder = HtmlBuilder<typeof Message.Type>

interface Slots {
  readonly music: Html
  readonly quote: Html
  readonly media: Html
  readonly editor: Html
  readonly savedMusic: Html
}

export const tweetComposer = (model: Model, h: Builder, busy: boolean, slots: Slots): Html => {
  const tool = (attachment: typeof Attachment.Type, label: string, path: string) =>
    h.button(
      [
        h.Type('button'),
        h.Id(`creator-${attachment}-tool`),
        h.Class('btn btn-quiet tweet-tool'),
        h.AriaExpanded(model.attachment === attachment),
        h.AriaControls('tweet-attachment-panel'),
        h.Disabled(busy),
        h.OnClick(Message.AttachmentToggled({ attachment })),
      ],
      [lucide(path, 'size-4'), label],
    )

  const panel = (): Html => {
    switch (model.attachment) {
      case 'music':
        return h.div(
          [],
          [
            model.draft.musicEntityId
              ? h.p([], ['Music is attached above. Remove it to choose something else.'])
              : slots.music,
            slots.savedMusic,
          ],
        )
      case 'quote':
        return slots.quote
      case 'media':
        return slots.media
      default:
        return h.empty
    }
  }

  return h.main(
    [h.Class('creator-canvas tweet-compose'), h.AriaLabel('Tweet composer')],
    [
      titleField(model, h),
      showsBodyEditor(model) ? slots.editor : h.empty,
      model.draft.musicEntityId ? slots.music : h.empty,
      model.draft.quotedPostId
        ? h.blockquote(
            [h.Class('tweet-quoted'), h.AriaLabel('Attached quote')],
            [
              h.small([], ['Quoted tweet']),
              h.p([], [model.quotePreview || model.draft.quoteUrl || 'Attached tweet']),
              !model.draft.editSlug
                ? h.button(
                    [
                      h.Type('button'),
                      h.Class('btn btn-quiet btn-sm'),
                      h.AriaLabel('Remove quote'),
                      h.Disabled(busy),
                      h.OnClick(Message.QuoteUrlChanged({ value: '' })),
                    ],
                    ['Remove'],
                  )
                : h.empty,
            ],
          )
        : h.empty,
      h.div(
        [h.Class('tweet-tools'), h.Role('group'), h.AriaLabel('Add to your tweet')],
        [
          tool('music', 'Music', iconPaths.music),
          !model.draft.editSlug ? tool('quote', 'Quote', iconPaths.replies) : h.empty,
          tool('media', 'Media', iconPaths.play),
          !showsBodyEditor(model)
            ? h.button(
                [
                  h.Type('button'),
                  h.Class('btn btn-quiet tweet-tool'),
                  h.AriaLabel('+ Add a longer note'),
                  h.Disabled(busy),
                  h.OnClick(Message.BodyEditorOpened()),
                ],
                [lucide(iconPaths.edit, 'size-4'), 'Note'],
              )
            : h.empty,
        ],
      ),
      h.div(
        [
          h.Id('tweet-attachment-panel'),
          h.Class('tweet-attachment-panel'),
          h.Hidden(model.attachment === null),
        ],
        [panel()],
      ),
    ],
  )
}
