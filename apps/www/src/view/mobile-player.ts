import type { HtmlBuilder } from 'foldkit/html'

import { artwork } from './artwork'
import { iconPaths, lucide } from './icons'

export type NowPlaying = {
  readonly title: string
  readonly subtitle: string
  readonly hasNext: boolean
  readonly thumbnailUrl: string | null
  readonly isPlaying: boolean
  readonly progress: number
}

const glyphButton = 'btn btn-quiet btn-icon shrink-0 text-foreground'

export const mobilePlayer = <M>(
  h: HtmlBuilder<M>,
  current: NowPlaying | null,
  queueResolved: boolean,
  openPlayer: M,
  togglePlay: M,
) => {
  if (!current && queueResolved) return h.empty

  return h.section(
    [
      h.AriaLabel('Mini player'),
      h.Class(`dock-platter dock-player ${current ? 'mobile-player' : 'mobile-player-pending'}`),
    ],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaLabel('Now playing'),
          h.Disabled(!current),
          h.OnClick(openPlayer),
          h.Class(
            'flex h-full min-w-0 flex-1 items-center gap-3 rounded-sm border-0 bg-transparent py-0 pl-2 pr-1 text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          ),
        ],
        [
          current
            ? artwork(
                current.thumbnailUrl,
                '',
                '40px',
                false,
                'size-10 shrink-0 rounded-none object-cover shadow-sm',
              )
            : h.span([
                h.Class(
                  'size-10 shrink-0 rounded-none bg-muted bg-cover bg-center [background-image:var(--queued-art)]',
                ),
              ]),
          h.span(
            [h.Class('min-w-0 flex-1 leading-tight')],
            [
              h.span(
                [h.Class('block truncate text-[13px] font-semibold')],
                [current?.title ?? 'Loading…'],
              ),
              current?.subtitle
                ? h.span(
                    [h.Class('mt-0.5 block truncate text-xs text-muted-foreground')],
                    [current.subtitle],
                  )
                : h.empty,
            ],
          ),
        ],
      ),
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(current?.isPlaying ? 'Pause' : 'Play'),
          h.Disabled(!current),
          h.OnClick(togglePlay),
          h.Class(glyphButton),
        ],
        [lucide(current?.isPlaying ? iconPaths.pause : iconPaths.play, 'size-6 fill-current')],
      ),
      current
        ? h.div(
            [h.AriaHidden(true), h.Class('absolute inset-x-4 bottom-0 h-0.5 bg-foreground/10')],
            [
              h.div(
                [h.Class('h-full bg-highlight'), h.Style({ width: `${current.progress}%` })],
                [],
              ),
            ],
          )
        : h.empty,
    ],
  )
}
