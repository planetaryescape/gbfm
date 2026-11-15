import * as Dialog from '@foldkit/ui/dialog'
import type { HtmlBuilder } from 'foldkit/html'

import { Message } from '../message'
import type { Model } from '../model'
import { iconPaths, lucide } from './icons'

export const videoDialog = (h: HtmlBuilder<Message>, { videoDialog: dialogModel, video }: Model) =>
  h.submodel({
    slotId: 'video-dialog',
    model: dialogModel,
    view: Dialog.view,
    viewInputs: {
      toView: ({ dialog, backdrop, panel, title, initialFocus, closeButton, isVisible }) =>
        h.dialog(
          [...dialog, h.Class('video-dialog')],
          isVisible && video
            ? [
                h.div([...backdrop, h.Class('video-dialog-backdrop')]),
                h.div(
                  [...panel, h.Class('video-dialog-panel')],
                  [
                    h.div(
                      [h.Class('video-dialog-frame')],
                      [
                        h.iframe(
                          [
                            h.Src(video.embedUrl),
                            h.Title(video.title),
                            h.Allow('autoplay; encrypted-media; fullscreen; picture-in-picture'),
                            h.Referrerpolicy('strict-origin-when-cross-origin'),
                            h.Sandbox(
                              'allow-scripts allow-same-origin allow-presentation allow-popups',
                            ),
                          ],
                          [],
                        ),
                      ],
                    ),
                    h.div(
                      [h.Class('video-dialog-foot')],
                      [
                        h.p([...title, h.Class('video-dialog-title')], [video.title]),
                        h.a(
                          [
                            h.Href(video.canonicalUrl),
                            h.Target('_blank'),
                            h.Rel('noopener noreferrer'),
                            h.Class('video-dialog-link'),
                          ],
                          ['Watch on YouTube'],
                        ),
                        h.button(
                          [
                            ...closeButton,
                            ...initialFocus,
                            h.Class('video-dialog-close'),
                            h.AriaLabel('Close video'),
                          ],
                          [lucide(iconPaths.close, 'h-5 w-5')],
                        ),
                      ],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage: (message) => Message.GotVideoDialogMessage({ message }),
  })
