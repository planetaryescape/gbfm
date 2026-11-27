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
import { createReaderSwipeMotion } from './swipe-motion'

export const ReaderArticle = Html.ref('ReaderPage.article', 'article')

export const ReaderNewer = Html.ref('ReaderPage.newer', 'a')

export const ReaderOlder = Html.ref('ReaderPage.older', 'a')

export const FollowReaderEntry = Mount.make(
  'FollowReaderEntry',
  { args: { enabled: Schema.Boolean, href: Schema.String } },
  (node: HTMLAnchorElement, _args, changes) =>
    Stream.runForEach(changes, ({ enabled, href }) =>
      Effect.sync(() => {
        if (
          !enabled ||
          !node.isConnected ||
          node.closest('[hidden], [inert]') ||
          node.getAttribute('href') !== href ||
          node.href === node.ownerDocument.location.href
        )
          return
        node.click()
      }),
    ).pipe(Effect.as(Component.noop)),
)

const excluded =
  'a, button, summary, details, input, textarea, select, [contenteditable], img, video, audio, iframe, [role="slider"], [data-swipe-exclude]'

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
        let held = _args
        let lastProgress = -1
        const document = node.ownerDocument
        const window = document.defaultView

        if (!window) return
        const motion = createReaderSwipeMotion(node, window)

        const interactive = () =>
          token.active && node.isConnected && node.closest('[hidden], [inert]') === null

        const reset = () => {
          gesture = null
          identifier = null
          motion.reset()
        }

        const navigate = (direction: 'newer' | 'older') => {
          if (!interactive()) return
          const link = node.querySelector<HTMLAnchorElement>(`a[data-reader-${direction}]`)

          if (!link) return
          link.click()
        }

        const point = (event: TouchEvent, touch: Touch, ending = false) => ({
          x: touch.clientX,
          y: touch.clientY,
          time: event.timeStamp,
          pointers: ending ? Number(event.touches.length === 0) : event.touches.length,
        })

        const start = (event: TouchEvent) => {
          gesture = null
          identifier = null

          if (event.touches.length !== 1) {
            motion.rebound()

            return
          }

          if (motion.busy() || blocked(node, event.target) || !interactive()) return
          const surface = node.querySelector('[data-tweet-swipe]')

          if (surface?.getAttribute('data-swipe-ready') !== 'true') return
          const touch = event.touches[0]

          if (!touch || event.touches.length !== 1) return
          held = token
          gesture = beginReaderSwipe(point(event, touch), window.innerWidth)
          identifier = touch.identifier
        }

        const move = (event: TouchEvent) => {
          if (!interactive()) {
            gesture = null
            motion.suspend()

            return
          }

          if (!gesture) return
          const touch = Array.from(event.touches).find((entry) => entry.identifier === identifier)
          gesture = touch ? moveReaderSwipe(gesture, point(event, touch)) : null

          if (!gesture || gesture.maxVertical > 40) {
            gesture = null
            motion.rebound()

            return
          }

          const dx = (gesture.samples.at(-1)?.x ?? 0) - gesture.origin.x
          const direction = dx < 0 ? 'older' : 'newer'
          const available = node.querySelector(`a[data-reader-${direction}]`) !== null
          const surface = node.querySelector('[data-tweet-swipe]')

          if (surface) motion.drag(surface, readerSwipeOffset(gesture, available))

          if (gesture.axis === 'horizontal' && event.cancelable) event.preventDefault()
        }

        const end = (event: TouchEvent) => {
          if (
            blocked(node, event.target) ||
            window.getSelection()?.isCollapsed === false ||
            held !== token ||
            !interactive()
          ) {
            gesture = null
            motion.rebound()

            return
          }

          const touch = Array.from(event.changedTouches).find(
            (entry) => entry.identifier === identifier,
          )

          const direction = touch ? finishReaderSwipe(gesture, point(event, touch, true)) : null
          gesture = null
          identifier = null
          const surface = node.querySelector('[data-tweet-swipe]')

          if (!direction || !surface || !node.querySelector(`a[data-reader-${direction}]`)) {
            motion.rebound()

            return
          }

          if (event.cancelable) event.preventDefault()
          motion.commit(surface, token.slug, direction, () => {
            if (held === token && interactive() && surface.isConnected && !blocked(node, null))
              navigate(direction)
            else reset()
          })
        }

        const cancel = () => {
          gesture = null
          identifier = null
          motion.rebound()
        }

        const key = (event: KeyboardEvent) => {
          if (
            !interactive() ||
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
          reset()
          navigate(direction)
        }

        const progress = () => {
          if (!interactive()) return
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
            node.addEventListener('touchcancel', cancel)
            document.addEventListener('keydown', key)
            window.addEventListener('scroll', progress, { passive: true })
            window.addEventListener('resize', progress)
            window.addEventListener('blur', reset)
            window.addEventListener('popstate', reset)
            window.addEventListener('gbfm:navigation-end', motion.navigationEnded)
          }),
          () =>
            Effect.sync(() => {
              reset()
              motion.dispose()
              node.removeEventListener('touchstart', start)
              node.removeEventListener('touchmove', move)
              node.removeEventListener('touchend', end)
              node.removeEventListener('touchcancel', cancel)
              document.removeEventListener('keydown', key)
              window.removeEventListener('scroll', progress)
              window.removeEventListener('resize', progress)
              window.removeEventListener('blur', reset)
              window.removeEventListener('popstate', reset)
              window.removeEventListener('gbfm:navigation-end', motion.navigationEnded)
            }),
        )
        yield* Stream.runForEach(changes, (next) =>
          Effect.sync(() => {
            if (next.identity !== token.identity) motion.reset()

            if (!next.active) motion.suspend()
            token = next
            gesture = null
            identifier = null
            lastProgress = -1

            if (next.active) {
              motion.navigationEnded()
              Queue.offerUnsafe(queue, ReaderPageMessage.CommittedReader(next))
            }

            progress()
          }),
        ).pipe(Effect.forkScoped)
      }),
    ),
)
