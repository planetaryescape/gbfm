import { Component, Mount } from '@effect/ui'
import { Html } from '@effect/ui/html'
import {
  beginReaderSwipe,
  finishReaderSwipe,
  moveReaderSwipe,
  readerSwipeOffset,
  type ReaderSwipe,
} from '@gbfm/core/reader-swipe'
import { Effect, Queue, Schema, Stream } from 'effect'

import { ReaderPageMessage, VisitToken } from './contracts'

export const ReaderArticle = Html.ref('ReaderPage.article', 'article')

export const ReaderNewer = Html.ref('ReaderPage.newer', 'a')

export const ReaderOlder = Html.ref('ReaderPage.older', 'a')

export const FollowReaderEntry = Mount.make(
  'FollowReaderEntry',
  { args: { enabled: Schema.Boolean } },
  (node: HTMLAnchorElement, _args, changes) =>
    Stream.runForEach(changes, ({ enabled }) =>
      Effect.sync(() => {
        if (!enabled || node.href === node.ownerDocument.location.href) return
        node.click()
      }),
    ).pipe(Effect.as(Component.noop)),
)

const excluded =
  'a, button, summary, input, textarea, select, [contenteditable], img, video, audio, iframe, [role="slider"], [data-swipe-exclude]'

const blocked = (node: HTMLElement, target: EventTarget | null) =>
  (target instanceof Element && target.closest(excluded) !== null) ||
  node.ownerDocument.querySelector(
    'dialog[open], :popover-open, details[data-tweet-dock][open]',
  ) !== null

const blockedKey = (node: HTMLElement, target: EventTarget | null) =>
  (target instanceof Element &&
    target.closest('button, summary, input, textarea, select, [contenteditable]') !== null) ||
  node.ownerDocument.querySelector(
    'dialog[open], :popover-open, details[data-tweet-dock][open], #account-menu-button[aria-expanded="true"]',
  ) !== null

export const TrackReader = Mount.makeStream(
  'TrackReader',
  { args: { ...VisitToken.fields, active: Schema.Boolean } },
  (node: HTMLElement, _args, changes) =>
    Stream.callback<ReaderPageMessage>(
      Effect.fnUntraced(function* (queue) {
        let token = _args
        let gesture: ReaderSwipe | null = null
        let identifier: number | null = null
        let lastProgress = -1
        const document = node.ownerDocument
        const window = document.defaultView

        if (!window) return
        const motion = () => node.querySelector<HTMLElement>('[data-reader-motion]')

        const reset = () => {
          gesture = null
          identifier = null
          const surface = motion()

          if (surface) surface.style.transform = ''
        }

        const navigate = (direction: 'newer' | 'older') => {
          if (!token.active) return
          const link = node.querySelector<HTMLAnchorElement>(`a[data-reader-${direction}]`)

          if (!link) return
          link.click()
          reset()
        }

        const point = (event: TouchEvent, touch: Touch, ending = false) => ({
          x: touch.clientX,
          y: touch.clientY,
          time: event.timeStamp,
          pointers: ending ? Number(event.touches.length === 0) : event.touches.length,
        })

        const start = (event: TouchEvent) => {
          reset()

          if (blocked(node, event.target) || !token.active) return
          const touch = event.touches[0]

          if (!touch || event.touches.length !== 1) return
          gesture = beginReaderSwipe(point(event, touch), window.innerWidth)
          identifier = touch.identifier
        }

        const move = (event: TouchEvent) => {
          const touch = Array.from(event.touches).find((entry) => entry.identifier === identifier)
          gesture = touch ? moveReaderSwipe(gesture, point(event, touch)) : null

          if (gesture?.axis !== 'horizontal') return

          if (event.cancelable) event.preventDefault()
          const dx = (gesture.samples.at(-1)?.x ?? 0) - gesture.origin.x
          const direction = dx < 0 ? 'older' : 'newer'
          const available = node.querySelector(`a[data-reader-${direction}]`) !== null
          const surface = motion()

          if (surface)
            surface.style.transform = `translateX(${readerSwipeOffset(gesture, available)}px)`
        }

        const end = (event: TouchEvent) => {
          if (blocked(node, event.target) || window.getSelection()?.isCollapsed === false) {
            reset()

            return
          }

          const touch = Array.from(event.changedTouches).find(
            (entry) => entry.identifier === identifier,
          )

          const direction = touch ? finishReaderSwipe(gesture, point(event, touch, true)) : null
          reset()

          if (direction) navigate(direction)
        }

        const key = (event: KeyboardEvent) => {
          if (
            event.defaultPrevented ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey ||
            event.repeat ||
            blockedKey(node, event.target)
          )
            return

          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          const direction = event.key === 'ArrowLeft' ? 'newer' : 'older'

          if (!node.querySelector(`a[data-reader-${direction}]`)) return
          event.preventDefault()
          navigate(direction)
        }

        const progress = () => {
          const article = node.querySelector<HTMLElement>('[data-reader-article]')

          if (!article) return
          const bounds = article.getBoundingClientRect()
          const extent = Math.max(1, bounds.height - window.innerHeight)
          const value = Math.round(Math.min(1, Math.max(0, -bounds.top / extent)) * 100)

          if (value === lastProgress) return
          lastProgress = value
          Queue.offerUnsafe(
            queue,
            ReaderPageMessage.MeasuredProgress({ ...token, progress: value }),
          )
        }

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            node.addEventListener('touchstart', start, { passive: true })
            node.addEventListener('touchmove', move, { passive: false })
            node.addEventListener('touchend', end)
            node.addEventListener('touchcancel', reset)
            document.addEventListener('keydown', key)
            window.addEventListener('scroll', progress, { passive: true })
            window.addEventListener('resize', progress)
          }),
          () =>
            Effect.sync(() => {
              reset()
              node.removeEventListener('touchstart', start)
              node.removeEventListener('touchmove', move)
              node.removeEventListener('touchend', end)
              node.removeEventListener('touchcancel', reset)
              document.removeEventListener('keydown', key)
              window.removeEventListener('scroll', progress)
              window.removeEventListener('resize', progress)
            }),
        )
        yield* Stream.runForEach(changes, (next) =>
          Effect.sync(() => {
            token = next
            reset()
            lastProgress = -1

            if (next.active) Queue.offerUnsafe(queue, ReaderPageMessage.CommittedReader(next))
            progress()
          }),
        ).pipe(Effect.forkScoped)
      }),
    ),
)
