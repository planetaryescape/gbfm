import * as Dialog from '@foldkit/ui/dialog'
import type { HtmlBuilder } from 'foldkit/html'

import { artworkUrl, imageSource } from '../view/artwork'
import { iconPaths, lucide } from '../view/icons'
import { Message, type Model } from './model'
import { fallbackArtwork, ghostButton } from './view-styles'

type H = HtmlBuilder<typeof Message.Type>

export const queueSheet = (model: Model, h: H) => {
  const { tracks, currentIndex, current } = model.snapshot.queue

  return h.submodel({
    slotId: 'queue-dialog',
    model: model.queueDialog,
    view: Dialog.view,
    viewInputs: {
      toView: ({ dialog, backdrop, panel, title, isVisible }) =>
        h.dialog(
          [...dialog, h.Class('overlay-dialog')],
          isVisible
            ? [
                h.h2([...title, h.Class('sr-only')], ['Playback queue']),
                h.div(
                  [
                    ...backdrop,
                    h.Class(
                      'absolute inset-0 border-0 bg-black/80 p-0 animate-in fade-in duration-200 cursor-default',
                    ),
                  ],
                  [],
                ),
                h.aside(
                  [
                    ...panel,
                    h.AriaLabel('Playback queue'),
                    h.Class(
                      'absolute inset-y-0 right-0 flex w-full flex-col gap-4 overflow-hidden border-l border-border bg-background p-6 shadow-lg animate-in slide-in-from-right duration-300 sm:w-80',
                    ),
                  ],
                  [
                    h.header(
                      [h.Class('flex items-center justify-between')],
                      [
                        h.h2([h.Class('m-0 text-lg font-semibold text-foreground')], ['Queue']),
                        h.button(
                          [
                            h.Type('button'),
                            h.AriaLabel('Close queue'),
                            h.OnClick(Message.CloseQueue()),
                            h.Class(
                              `${ghostButton} h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground`,
                            ),
                          ],
                          [lucide(iconPaths.close, 'h-4 w-4')],
                        ),
                      ],
                    ),
                    h.div(
                      [h.Class('min-h-0 flex-1 overflow-y-auto px-2')],
                      [
                        current
                          ? h.div(
                              [h.Class('mb-4 border-b border-border p-3')],
                              [
                                h.h3(
                                  [h.Class('m-0 mb-2 text-xs font-medium text-muted-foreground')],
                                  ['Now playing'],
                                ),
                                h.div(
                                  [h.Class('flex items-center gap-3')],
                                  [
                                    h.img([
                                      imageSource(
                                        artworkUrl(current.thumbnailUrl || fallbackArtwork, 160),
                                      ),
                                      h.Alt(current.title),
                                      h.Class('h-12 w-12 shrink-0 rounded-none object-cover'),
                                    ]),
                                    h.h4(
                                      [
                                        h.Class(
                                          'm-0 min-w-0 flex-1 truncate text-base font-medium',
                                        ),
                                      ],
                                      [current.title],
                                    ),
                                  ],
                                ),
                              ],
                            )
                          : h.empty,
                        tracks.length === 0
                          ? h.div(
                              [
                                h.Class(
                                  'flex flex-col items-center justify-center p-8 text-center',
                                ),
                              ],
                              [
                                lucide(iconPaths.play, 'mb-4 h-8 w-8 text-muted-foreground'),
                                h.h3([h.Class('m-0 mb-2 font-medium')], ['Your queue is empty']),
                                h.p(
                                  [h.Class('text-base text-muted-foreground')],
                                  ['Add some tracks to get started'],
                                ),
                              ],
                            )
                          : h.div(
                              [],
                              [
                                h.h3(
                                  [h.Class('m-0 mb-3 text-base font-medium text-muted-foreground')],
                                  [`Up next (${tracks.length})`],
                                ),
                                h.ol(
                                  [h.Class('m-0 list-none space-y-1 p-0')],
                                  tracks.map((track, index) =>
                                    h.li(
                                      [
                                        h.Key(track.id),
                                        h.Draggable(true),
                                        h.OnDragStart(Message.DragStarted({ index })),
                                        h.OnDragOver(Message.OperationCompleted()),
                                        h.OnDrop(Message.DroppedAt({ index })),
                                        h.Class(
                                          `group m-0 flex list-none items-center gap-2 rounded-sm p-2 transition-colors hover:bg-muted ${
                                            index === currentIndex
                                              ? 'bg-muted/60 text-highlight'
                                              : ''
                                          }`,
                                        ),
                                      ],
                                      [
                                        h.img([
                                          imageSource(
                                            artworkUrl(track.thumbnailUrl || fallbackArtwork, 96),
                                          ),
                                          h.Alt(''),
                                          h.Class('h-10 w-10 shrink-0 rounded-none object-cover'),
                                        ]),
                                        h.button(
                                          [
                                            h.Type('button'),
                                            h.OnClick(Message.PlayIndex({ index })),
                                            h.Class(
                                              'min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-sm',
                                            ),
                                          ],
                                          [
                                            h.span(
                                              [h.Class('block truncate font-medium')],
                                              [track.title],
                                            ),
                                            h.span(
                                              [
                                                h.Class(
                                                  'block truncate text-xs text-muted-foreground',
                                                ),
                                              ],
                                              [
                                                index === currentIndex
                                                  ? 'Now playing'
                                                  : track.creators
                                                      ?.map(({ name }) => name)
                                                      .join(', ') || 'Unknown creator',
                                              ],
                                            ),
                                          ],
                                        ),
                                        h.button(
                                          [
                                            h.Type('button'),
                                            h.OnClick(
                                              Message.Reorder({ from: index, to: index - 1 }),
                                            ),
                                            h.Disabled(index === 0),
                                            h.AriaLabel(`Move ${track.title} up`),
                                            h.Class(
                                              `${ghostButton} h-7 w-7 text-muted-foreground hover:text-foreground`,
                                            ),
                                          ],
                                          [lucide('m18 15-6-6-6 6', 'h-3.5 w-3.5')],
                                        ),
                                        h.button(
                                          [
                                            h.Type('button'),
                                            h.OnClick(
                                              Message.Reorder({ from: index, to: index + 1 }),
                                            ),
                                            h.Disabled(index === tracks.length - 1),
                                            h.AriaLabel(`Move ${track.title} down`),
                                            h.Class(
                                              `${ghostButton} h-7 w-7 text-muted-foreground hover:text-foreground`,
                                            ),
                                          ],
                                          [lucide(iconPaths.chevronDown, 'h-3.5 w-3.5')],
                                        ),
                                        h.button(
                                          [
                                            h.Type('button'),
                                            h.OnClick(Message.Remove({ index })),
                                            h.AriaLabel(`Remove ${track.title}`),
                                            h.Class(
                                              `${ghostButton} h-7 w-7 text-muted-foreground hover:text-destructive`,
                                            ),
                                          ],
                                          [lucide(iconPaths.close, 'h-3.5 w-3.5')],
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                      ],
                    ),
                    h.button(
                      [
                        h.Type('button'),
                        h.OnClick(Message.Clear()),
                        h.Disabled(tracks.length === 0),
                        h.Class(
                          'h-9 w-full rounded-sm border border-border bg-transparent text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
                        ),
                      ],
                      ['Clear queue'],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage: (message) => Message.GotQueueDialogMessage({ message }),
  })
}
