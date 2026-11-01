import * as Dialog from '@foldkit/ui/dialog'
import type { QueueTrackType } from '@gbfm/player'
import type { HtmlBuilder } from 'foldkit/html'
import { defineView } from 'foldkit/submodel'

import { onDragStart } from '../sheet-drag'
import { artworkUrl, imageSource } from '../view/artwork'
import { iconPaths, lucide } from '../view/icons'
import { SuppressDragClick } from './drag-handle'
import * as Favorite from './favorite'
import { Message, type Model } from './model'
import { queueSheet } from './queue-view'
import { fallbackArtwork, ghostButton, progressRangeClass, volumeRangeClass } from './view-styles'

type H = HtmlBuilder<typeof Message.Type>

export type ViewInputs = Readonly<{ returnTo: string }>

const pad = (value: number) => value.toString().padStart(2, '0')

const time = (seconds: number) => {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)

  return `${hours > 0 ? `${pad(hours)}:` : ''}${pad(minutes)}:${pad(Math.floor(safe % 60))}`
}

const creatorLinks = (h: H, track: QueueTrackType) => {
  const creators = track.creators ?? []

  if (creators.length === 0) return h.span([], ['Unknown creator'])

  return h.p(
    [h.Class('mt-1 truncate text-base text-muted-foreground')],
    creators.flatMap((creator, index) => [
      creator.username
        ? h.a(
            [
              h.Key(creator.id),
              h.Href(`/profile/${encodeURIComponent(creator.username)}`),
              h.Class('no-underline hover:text-foreground hover:underline'),
            ],
            [creator.name],
          )
        : h.span([h.Key(creator.id)], [creator.name]),
      index < creators.length - 1 ? ', ' : '',
    ]),
  )
}

const dragAttributes = (h: H, allowControls = false) => [
  h.OnPointerDown(onDragStart(Message.PlayerDragStarted, allowControls)),
]

const transportButton = 'btn btn-quiet btn-icon text-foreground'

const backdrop = (h: H, current: QueueTrackType) =>
  h.div(
    [h.AriaHidden(true), h.Class('pointer-events-none absolute inset-0 -z-10 overflow-hidden')],
    [
      h.img([
        imageSource(artworkUrl(current.thumbnailUrl || fallbackArtwork, 96)),
        h.Alt(''),
        h.Draggable(false),
        h.Class('size-full scale-150 object-cover opacity-60 blur-3xl saturate-150'),
      ]),
      h.div(
        [
          h.Class(
            'absolute inset-0 bg-gradient-to-b from-background/50 via-background/75 to-background',
          ),
        ],
        [],
      ),
    ],
  )

const trackTitle = (h: H, current: QueueTrackType) =>
  current.slug
    ? h.a(
        [
          h.Href(`/mixes/${encodeURIComponent(current.slug)}`),
          h.Class(
            'block truncate text-xl font-semibold leading-tight text-foreground no-underline hover:underline sm:text-2xl',
          ),
        ],
        [current.title],
      )
    : h.span(
        [h.Class('block truncate text-xl font-semibold leading-tight text-foreground sm:text-2xl')],
        [current.title],
      )

const titleBlock = (model: Model, h: H, current: QueueTrackType, inputs: ViewInputs) =>
  h.div(
    [h.Class('relative mb-5 min-w-0 shrink-0 sm:mb-8')],
    [
      h.div(
        [h.Class('flex items-center gap-3')],
        [
          h.div([h.Class('min-w-0 flex-1')], [trackTitle(h, current), creatorLinks(h, current)]),
          Favorite.button(
            model.favorite,
            h,
            (message) => Message.GotFavoriteMessage({ message }),
            inputs.returnTo,
          ),
        ],
      ),
      Favorite.notice(model.favorite, h, (message) => Message.GotFavoriteMessage({ message })),
    ],
  )

const transportControls = (h: H, isPlaying: boolean) =>
  h.div(
    [h.Class('mb-5 flex shrink-0 items-center justify-center gap-8 sm:mb-8 sm:gap-12')],
    [
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.Previous()),
          h.AriaLabel('Previous track'),
          h.Class(transportButton),
        ],
        [lucide(iconPaths.skipBack, 'size-[26px] fill-current')],
      ),
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.TogglePlayPause()),
          h.AriaLabel(isPlaying ? 'Pause' : 'Play'),
          h.Class('btn btn-primary player-primary-control'),
        ],
        [lucide(isPlaying ? iconPaths.pause : iconPaths.play, 'size-[30px] fill-current')],
      ),
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.Next()),
          h.AriaLabel('Next track'),
          h.Class(transportButton),
        ],
        [lucide(iconPaths.skipForward, 'size-[26px] fill-current')],
      ),
    ],
  )

const utilityRow = (model: Model, h: H) => {
  const { volume, queue } = model.snapshot
  const muted = volume.isMuted || volume.volume === 0

  return h.div(
    [h.Class('flex shrink-0 items-center gap-4')],
    [
      h.div(
        [h.Class('hidden min-w-0 flex-1 items-center gap-4 sm:flex')],
        [
          h.button(
            [
              h.Type('button'),
              h.OnClick(Message.ToggleMute()),
              h.AriaLabel(volume.isMuted ? 'Unmute' : 'Mute'),
              h.Class(
                `${ghostButton} h-9 px-3 text-muted-foreground hover:bg-muted hover:text-foreground`,
              ),
            ],
            [lucide(muted ? iconPaths.volumeOff : iconPaths.volume, 'h-5 w-5')],
          ),
          h.input([
            h.Type('range'),
            h.Min('0'),
            h.Max('100'),
            h.Value(String(volume.isMuted ? 0 : volume.volume)),
            h.OnInput((value) => Message.SetVolume({ volume: Number(value) })),
            h.AriaLabel('Volume'),
            h.Title(`Volume: ${volume.volume}%`),
            h.Class(volumeRangeClass),
          ]),
          lucide(iconPaths.volume, 'h-5 w-5 text-muted-foreground'),
        ],
      ),
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.ToggleQueue()),
          h.Title('Toggle queue'),
          h.AriaLabel(`Queue (${queue.tracks.length})`),
          h.Class(
            `${ghostButton} relative ml-auto size-11 shrink-0 rounded-[0.75rem] text-muted-foreground hover:bg-foreground/10 hover:text-foreground`,
          ),
        ],
        [
          lucide(iconPaths.list, 'h-6 w-6'),
          queue.tracks.length > 0
            ? h.span(
                [
                  h.Class(
                    'absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-sm bg-primary px-0.5 text-[10px] font-bold text-primary-foreground',
                  ),
                ],
                [String(queue.tracks.length)],
              )
            : h.empty,
        ],
      ),
    ],
  )
}

const fullscreen = (model: Model, h: H, current: QueueTrackType, inputs: ViewInputs) => {
  const playback = model.snapshot.transport

  return h.section(
    [
      h.AriaLabel('Now playing'),
      h.Class(
        'absolute inset-0 isolate flex flex-col overflow-hidden bg-background text-foreground',
      ),
    ],
    [
      backdrop(h, current),
      h.div(
        [
          ...dragAttributes(h),
          h.Class(
            'player-drag-surface flex shrink-0 items-center justify-center px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:p-4',
          ),
        ],
        [
          h.button(
            [
              ...dragAttributes(h, true),
              h.OnMount(SuppressDragClick({})),
              h.Type('button'),
              h.AriaLabel('Collapse player'),
              h.OnClick(Message.CloseFullscreen()),
              h.Class(`${ghostButton} player-drag-handle`),
            ],
            [h.span([h.Class('player-drag-grip'), h.AriaHidden(true)])],
          ),
        ],
      ),
      h.div(
        [
          h.Class(
            'flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:justify-center sm:px-8 sm:pb-8',
          ),
        ],
        [
          h.div(
            [h.Class('flex min-h-0 w-full max-w-2xl flex-1 flex-col')],
            [
              h.div(
                [
                  ...dragAttributes(h),
                  h.Class(
                    'player-drag-surface mb-6 flex min-h-0 flex-1 items-center justify-center sm:mb-8',
                  ),
                ],
                [
                  h.img([
                    imageSource(artworkUrl(current.thumbnailUrl || fallbackArtwork, 1280)),
                    h.Alt(current.title),
                    h.Draggable(false),
                    ...(playback.isPlaying ? [] : [h.DataAttribute('paused', '')]),
                    h.Class(
                      'player-artwork max-h-full max-w-full rounded-none object-contain shadow-2xl',
                    ),
                  ]),
                ],
              ),
              titleBlock(model, h, current, inputs),
              h.div(
                [h.Class('mb-4 shrink-0 sm:mb-8')],
                [
                  h.input([
                    h.Type('range'),
                    h.Min('0'),
                    h.Max(String(playback.duration || 0)),
                    h.Step('0.1'),
                    h.Value(String(playback.currentTime)),
                    h.OnInput((value) => Message.SeekTo({ seconds: Number(value) })),
                    h.AriaLabel('Playback position'),
                    h.Class(progressRangeClass),
                  ]),
                  h.div(
                    [
                      h.Class(
                        'mt-2 flex justify-between text-xs tabular-nums text-muted-foreground',
                      ),
                    ],
                    [
                      h.span([], [time(playback.currentTime)]),
                      h.span([], [`-${time(playback.duration - playback.currentTime)}`]),
                    ],
                  ),
                ],
              ),
              transportControls(h, playback.isPlaying),
              utilityRow(model, h),
            ],
          ),
        ],
      ),
    ],
  )
}

const pendingQueue = (model: Model, h: H) =>
  h.div(
    [
      h.AriaLabel('Audio player'),
      h.Class(
        'fixed bottom-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-2 rounded-sm border border-border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 lg:bottom-16',
      ),
    ],
    [
      h.span([], [`${model.snapshot.queue.tracks.length} queued`]),
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.PlayIndex({ index: 0 })),
          h.Class(`${ghostButton} gap-1 px-2 py-1 text-foreground hover:bg-muted`),
        ],
        [lucide(iconPaths.play, 'h-3 w-3 fill-current'), 'Play queue'],
      ),
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.ToggleQueue()),
          h.AriaLabel('Open queue'),
          h.Class(`${ghostButton} h-6 w-6 hover:bg-muted hover:text-foreground`),
        ],
        [lucide(iconPaths.list, 'h-3.5 w-3.5')],
      ),
    ],
  )

const playerDialog = (model: Model, h: H, inputs: ViewInputs) =>
  h.submodel({
    slotId: 'player-dialog',
    model: model.playerDialog,
    view: Dialog.view,
    viewInputs: {
      toView: ({ dialog, panel, title, initialFocus, isVisible }) =>
        h.dialog(
          [...dialog, h.Class('overlay-dialog player-dialog')],
          isVisible
            ? [
                h.h2(
                  [...title, ...initialFocus, h.Tabindex(-1), h.Class('sr-only')],
                  ['Now playing'],
                ),
                h.div(
                  [
                    ...panel,
                    h.Class('player-panel'),
                    h.Style({ '--player-drag-y': `${model.playerOffset}px` }),
                    ...(model.playerDrag ? [h.DataAttribute('dragging', '')] : []),
                  ],
                  [
                    model.snapshot.queue.current
                      ? fullscreen(model, h, model.snapshot.queue.current, inputs)
                      : h.p([h.Class('player-loading'), h.Role('status')], ['Loading player…']),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage: (message) => Message.GotPlayerDialogMessage({ message }),
  })

export const view = defineView<Model, typeof Message.Type, ViewInputs>((model, inputs, h) =>
  h.div(
    [],
    [
      playerDialog(model, h, inputs),
      !model.playerDialog.isOpen &&
      !model.snapshot.queue.current &&
      model.snapshot.queue.tracks.length
        ? pendingQueue(model, h)
        : h.empty,
      queueSheet(model, h),
    ],
  ),
)
