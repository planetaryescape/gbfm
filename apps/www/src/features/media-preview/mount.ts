import { Component, Mount, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Data, Effect, Queue, Schema, Stream } from 'effect'

import {
  browserPreviewSession,
  isPrivateMedia,
  previewDeniedEvent,
  type PreviewSession,
} from '../../media-preview/session'
import { PlayerMessage, PlayerProvider } from '../player/provider'

export const MediaPreviewMessage = UiSchema.TaggedEnum({ DeniedPreview: {}, DismissedNotice: {} })

export const MediaPreviewEvents = UiSchema.TaggedEnum({ Denied: {} })

type PreviewWork =
  | { readonly _tag: 'Denied' }
  | {
      readonly _tag: 'Image'
      readonly image: HTMLImageElement
      readonly url: string
      readonly session: PreviewSession
      readonly owns: () => boolean
    }

const PreviewWork = Data.taggedEnum<PreviewWork>()

export const ObservePrivateMedia = Mount.makeStream(
  'ObservePrivateMedia',
  { args: {} },
  (element: HTMLElement) =>
    Stream.callback<PreviewWork>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const images = new Map<HTMLImageElement, { url: string; session: PreviewSession }>()
          const window = element.ownerDocument.defaultView
          const denied = () => Queue.offerUnsafe(queue, PreviewWork.Denied())
          window?.addEventListener(previewDeniedEvent, denied)

          const scan = () => {
            for (const [image, entry] of images) {
              const src = image.getAttribute('data-private-media-src') ?? image.getAttribute('src')

              if (!element.contains(image) || (src !== null && src !== entry.url)) {
                entry.session.dispose()
                images.delete(image)

                if (src && !isPrivateMedia(src)) image.removeAttribute('crossorigin')
              }
            }

            element.querySelectorAll('img').forEach((image) => {
              const url = image.getAttribute('data-private-media-src') ?? image.getAttribute('src')

              if (!url || !isPrivateMedia(url) || images.has(image)) return
              image.removeAttribute('src')
              image.removeAttribute('srcset')
              image.crossOrigin = 'use-credentials'
              const session = browserPreviewSession(url)
              images.set(image, { url, session })
              Queue.offerUnsafe(
                queue,
                PreviewWork.Image({
                  image,
                  url,
                  session,
                  owns: () => images.get(image)?.session === session && element.contains(image),
                }),
              )
            })
          }

          const observer = new MutationObserver(scan)
          observer.observe(element, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'srcset', 'data-private-media-src'],
          })
          scan()

          return () => {
            observer.disconnect()
            window?.removeEventListener(previewDeniedEvent, denied)

            for (const { session } of images.values()) session.dispose()
            images.clear()
          }
        }),
        (cleanup) => Effect.sync(cleanup),
      ),
    ).pipe(
      Stream.mapEffect(
        (
          work,
        ): Effect.Effect<Component.Noop | typeof MediaPreviewMessage.cases.DeniedPreview.Type> => {
          return PreviewWork.$match(work, {
            Denied: () => Effect.succeed(MediaPreviewMessage.DeniedPreview()),
            Image: (image) =>
              Effect.promise(() => image.session.ensure()).pipe(
                Effect.map((result) => {
                  if (result.ok && image.owns()) image.image.src = image.url

                  return Component.noop
                }),
              ),
          })
        },
        { concurrency: 'unbounded' },
      ),
    ),
)

export const MediaPreviewBoundary = Html.component({
  name: 'MediaPreviewBoundary',
  model: Schema.Struct({ denied: Schema.Boolean }),
  message: MediaPreviewMessage,
  events: MediaPreviewEvents,
  slots: ['content'],
  restore: false,
}).make({
  init: () => ({ denied: false }),
  update: {
    DeniedPreview: ($) =>
      $.evolve({ denied: true })
        .send(PlayerProvider, PlayerMessage.RequestedCloseOverlays())
        .emit(MediaPreviewEvents.Denied()),
    DismissedNotice: ($) => $.evolve({ denied: false }),
  },
  view: (h, model) =>
    h.div
      .onMount(ObservePrivateMedia())
      .children(
        model.denied &&
          h.div
            .attr('role', 'alert')
            .class('notice notice-error')
            .children(
              h.p(
                'Private media preview is unavailable. Check your sign-in and permission, then try again.',
              ),
              h.button
                .attr('type', 'button')
                .class('btn')
                .on('click', MediaPreviewMessage.DismissedNotice())
                .children('Dismiss'),
            ),
        h.slots.content,
      ),
})
