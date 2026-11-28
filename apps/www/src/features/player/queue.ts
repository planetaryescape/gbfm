import { UiSchema } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import { Html } from '@effect/ui/html'
import { Exit, Predicate, Schema } from 'effect'

import { iconPaths, lucide } from '../../ui/icons'
import { PlayerControlMessage, PlayerProviderMessage } from './domain'
import { Artwork, ghostButton } from './presentation'
import { PlayerProvider } from './provider'

const QueueDropMessage = UiSchema.TaggedEnum({
  DroppedQueueTrack: { data: Schema.String, index: Schema.Number },
})

const QueueMessage = Schema.Union([PlayerControlMessage, QueueDropMessage])

const QueueDrag = Schema.Struct({ index: Schema.Int })

const queueType = 'application/x-gbfm-queue-index'

export const QueuePlayer = Html.component({
  name: 'QueuePlayer',
  model: Schema.Null,
  message: QueueMessage,
  reads: { provider: PlayerProvider },
}).make({
  init: () => null,
  update: ($, message) => {
    if (!Predicate.isTagged(message, 'DroppedQueueTrack')) return $.send(PlayerProvider, message)
    const decoded = Schema.decodeUnknownExit(Schema.fromJsonString(QueueDrag))(message.data)

    if (Exit.isFailure(decoded)) return $.model
    const length = $.reads.provider.snapshot.queue.tracks.length

    if (
      decoded.value.index < 0 ||
      decoded.value.index >= length ||
      message.index < 0 ||
      message.index >= length
    )
      return $.model

    return $.send(
      PlayerProvider,
      PlayerProviderMessage.RequestedReorder({ from: decoded.value.index, to: message.index }),
    )
  },
  view: (h) => {
    const { queueOpen, snapshot } = h.reads.provider
    const { current, tracks, currentIndex } = snapshot.queue

    return Dialog(h, {
      props: { open: queueOpen, keepMounted: true, id: 'playback-queue' },
      onEmit: {
        RequestedOpen: () => undefined,
        RequestedClose: () => PlayerProviderMessage.RequestedCloseQueue(),
        Settled: () => undefined,
      },
      view: (dialog) =>
        dialog.portal(h.dialog.class('native-player-dialog'))?.children(
          dialog.backdrop(h.div.class('fixed inset-0 bg-black/80')),
          dialog
            .popup(
              h.div.class(
                'fixed inset-y-0 right-0 flex w-full flex-col gap-4 overflow-hidden border-l border-border bg-background p-6 shadow-lg sm:w-80',
              ),
            )
            .attr('aria-label', 'Playback queue')
            .children(
              h.header
                .class('flex items-center justify-between')
                .children(
                  dialog
                    .title(h.h2.class('m-0 text-lg font-semibold text-foreground'))
                    .children('Queue'),
                  dialog
                    .close(
                      h.button
                        .attr('type', 'button')
                        .attr('aria-label', 'Close queue')
                        .class(
                          `${ghostButton} h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground`,
                        ),
                    )
                    .children(lucide(h, iconPaths.close, 'h-4 w-4')),
                ),
              h.div.class('min-h-0 flex-1 overflow-y-auto px-2').children(
                current &&
                  h.div
                    .class('mb-4 border-b border-border p-3')
                    .children(
                      h.h3
                        .class('m-0 mb-2 text-xs font-medium text-muted-foreground')
                        .children('Now playing'),
                      h.div
                        .class('flex items-center gap-3')
                        .children(
                          Artwork(
                            h,
                            current.thumbnailUrl,
                            current.title,
                            160,
                            'h-12 w-12 shrink-0 rounded-none object-cover',
                          ),
                          h.h4
                            .class('m-0 min-w-0 flex-1 truncate text-base font-medium')
                            .children(current.title),
                        ),
                    ),
                tracks.length === 0 &&
                  h.div
                    .class('p-8 text-center')
                    .children(
                      h.h3('Your queue is empty'),
                      h.p.class('text-muted-foreground').children('Add some tracks to get started'),
                    ),
                tracks.length > 0 &&
                  h.div.children(
                    h.h3
                      .class('m-0 mb-3 text-base font-medium text-muted-foreground')
                      .children(`Up next (${tracks.length})`),
                    h.ol.class('m-0 list-none space-y-1 p-0').children(
                      tracks.map((track, index) =>
                        h.li
                          .key(track.id)
                          .draggable({ [queueType]: JSON.stringify({ index }) })
                          .dropTarget({ accepts: [queueType], dropEffect: 'move' })
                          .on('drop', ({ data }) =>
                            QueueDropMessage.DroppedQueueTrack({
                              data: data[queueType] ?? '',
                              index,
                            }),
                          )
                          .class(
                            `group m-0 flex list-none items-center gap-2 rounded-sm p-2 transition-colors hover:bg-muted ${index === currentIndex ? 'bg-muted/60 text-highlight' : ''}`,
                          )
                          .children(
                            Artwork(
                              h,
                              track.thumbnailUrl,
                              '',
                              96,
                              'h-10 w-10 shrink-0 rounded-none object-cover',
                            ),
                            h.button
                              .attr('type', 'button')
                              .class('min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-sm')
                              .on('click', PlayerProviderMessage.RequestedPlayIndex({ index }))
                              .children(
                                h.span.class('block truncate font-medium').children(track.title),
                                h.span
                                  .class('block truncate text-xs text-muted-foreground')
                                  .children(
                                    index === currentIndex
                                      ? 'Now playing'
                                      : track.creators?.map(({ name }) => name).join(', ') ||
                                          'Unknown creator',
                                  ),
                              ),
                            h.button
                              .attr('type', 'button')
                              .attr('aria-label', `Move ${track.title} up`)
                              .disabled(index === 0)
                              .class(`${ghostButton} h-7 w-7`)
                              .on(
                                'click',
                                PlayerProviderMessage.RequestedReorder({
                                  from: index,
                                  to: index - 1,
                                }),
                              )
                              .children(lucide(h, 'm18 15-6-6-6 6', 'h-3.5 w-3.5')),
                            h.button
                              .attr('type', 'button')
                              .attr('aria-label', `Move ${track.title} down`)
                              .disabled(index === tracks.length - 1)
                              .class(`${ghostButton} h-7 w-7`)
                              .on(
                                'click',
                                PlayerProviderMessage.RequestedReorder({
                                  from: index,
                                  to: index + 1,
                                }),
                              )
                              .children(lucide(h, iconPaths.chevronDown, 'h-3.5 w-3.5')),
                            h.button
                              .attr('type', 'button')
                              .attr('aria-label', `Remove ${track.title}`)
                              .class(`${ghostButton} h-7 w-7`)
                              .on('click', PlayerProviderMessage.RequestedRemove({ index }))
                              .children(lucide(h, iconPaths.close, 'h-3.5 w-3.5')),
                          ),
                      ),
                    ),
                  ),
              ),
              h.button
                .attr('type', 'button')
                .disabled(tracks.length === 0)
                .class('btn w-full')
                .on('click', PlayerProviderMessage.RequestedClear())
                .children('Clear queue'),
            ),
        ) ?? h.text(''),
    })
  },
})
