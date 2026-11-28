import { Component, Mount, UiSchema } from '@effect/ui'
import { BrowserHost, Html, HtmlServer } from '@effect/ui/html'
import { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { Effect, Fiber, Option, Queue, Schema, Stream } from 'effect'

import { siteHttpClientLayer } from '../../src/app/http-client'
import { screen, neighbours } from '../../src/features/reader/fixtures.test-support'
import { ReaderPage } from '../../src/features/reader/page'
import { spotifyCommandsLayer } from '../../src/features/spotify/commands'
import { SpotifyProvider } from '../../src/features/spotify/provider'

const ReaderRuntimeMessage = UiSchema.TaggedEnum({
  ClickedReaderLink: { slug: Schema.String },
  CompletedDestination: { slug: Schema.String },
  FailedDestination: {},
  PausedFixture: {},
  ResumedFixture: {},
})

const ObserveReaderFixture = Mount.makeStream(
  'ObserveReaderFixture',
  { args: {} },
  (node: HTMLElement) =>
    Stream.callback<typeof ReaderRuntimeMessage.Type>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const click = (event: MouseEvent) => {
            if (!(event.target instanceof Element)) return
            const link = event.target.closest('a[data-reader-older], a[data-reader-newer]')

            if (!(link instanceof HTMLAnchorElement)) return
            event.preventDefault()
            const slug = new URL(link.href).pathname.split('/').at(-1)

            if (slug) Queue.offerUnsafe(queue, ReaderRuntimeMessage.ClickedReaderLink({ slug }))
          }

          const complete = (event: Event) => {
            if (!(event instanceof CustomEvent)) return
            const slug = Schema.decodeUnknownOption(Schema.String)(event.detail)

            if (Option.isNone(slug)) return
            window.history.replaceState(null, '', `/tweet/${encodeURIComponent(slug.value)}`)
            Queue.offerUnsafe(
              queue,
              ReaderRuntimeMessage.CompletedDestination({ slug: slug.value }),
            )
          }

          const failed = () => {
            window.dispatchEvent(new Event('gbfm:navigation-end'))
            Queue.offerUnsafe(queue, ReaderRuntimeMessage.FailedDestination())
          }

          const pause = () => Queue.offerUnsafe(queue, ReaderRuntimeMessage.PausedFixture())
          const resume = () => Queue.offerUnsafe(queue, ReaderRuntimeMessage.ResumedFixture())
          node.addEventListener('click', click)
          window.addEventListener('fixture:destination', complete)
          window.addEventListener('fixture:navigation-failed', failed)
          window.addEventListener('fixture:pause', pause)
          window.addEventListener('fixture:live', resume)

          return () => {
            node.removeEventListener('click', click)
            window.removeEventListener('fixture:destination', complete)
            window.removeEventListener('fixture:navigation-failed', failed)
            window.removeEventListener('fixture:pause', pause)
            window.removeEventListener('fixture:live', resume)
          }
        }),
        (dispose) => Effect.sync(dispose),
      ),
    ),
)

export const readerRuntimeNeighbours = (slug: string) =>
  Schema.decodeUnknownSync(MicroPostNeighboursResponse)({
    ...neighbours,
    newer: slug === 'a' ? null : 'a',
    older: slug === 'a' ? 'b' : 'c',
  })

const ReaderRuntime = Html.component({
  name: 'ReaderRuntime',
  props: Schema.Struct({ origin: Schema.URL }),
  model: Schema.Struct({
    slug: Schema.String,
    active: Schema.Boolean,
    navigationId: Schema.Number,
    navigations: Schema.Number,
    pending: Schema.Boolean,
    requested: Schema.NullOr(Schema.String),
    version: Schema.Number,
  }),
  message: ReaderRuntimeMessage,
  restore: false,
})
  .make({
    init: () => ({
      slug: 'a',
      active: true,
      navigationId: 0,
      navigations: 0,
      pending: false,
      requested: null,
      version: 0,
    }),
    update: {
      ClickedReaderLink: ($, { slug }) =>
        $.evolve({ requested: slug, pending: true, navigations: $.model.navigations + 1 }),
      CompletedDestination: ($, { slug }) =>
        $.evolve({ slug, pending: false, navigationId: $.model.navigationId + 1 }),
      FailedDestination: ($) => $.evolve({ pending: false }),
      PausedFixture: ($) => $.evolve({ active: false, version: $.model.version + 1 }),
      ResumedFixture: ($) => $.evolve({ active: true, version: $.model.version + 1 }),
    },
    view: (h, model) =>
      h.main
        .attr('id', 'reader-runtime')
        .attr('data-navigation-count', String(model.navigations))
        .attr('data-navigation-pending', String(model.pending))
        .attr('data-requested-slug', model.requested ?? '')
        .attr('data-view-state', model.active ? 'Live' : 'Paused')
        .attr('data-view-version', String(model.version))
        .onMount(ObserveReaderFixture())
        .children(
          SpotifyProvider(h, {
            props: { identity: 'anonymous' },
            view: () =>
              ReaderPage(h, {
                props: {
                  url: new URL(`/tweet/${model.slug}`, h.props.origin),
                  principal: null,
                  screen: screen(model.slug),
                  neighbours: readerRuntimeNeighbours(model.slug),
                  posts: [],
                  renderedAt: 1711929600000,
                  failure: null,
                  status: 200,
                  navigationId: model.navigationId,
                  navigationAction: model.navigationId === 0 ? 'initial' : 'push',
                  active: model.active,
                },
              }),
          }),
        ),
  })
  .pipe(Component.provide(spotifyCommandsLayer))

export const renderReaderRuntime = (origin: URL) =>
  HtmlServer.renderToHtml(ReaderRuntime.pipe(Component.provide(siteHttpClientLayer(origin))), {
    origin,
  })

export const mountReaderRuntime = () => {
  const container = document.getElementById('reader-runtime-container')

  if (!container) throw new Error('Missing reader runtime container')
  container.replaceChildren()
  window.history.replaceState(null, '', '/tweet/a')

  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* BrowserHost.mountEffect(
          ReaderRuntime.pipe(Component.provide(siteHttpClientLayer(new URL(window.location.href)))),
          { origin: new URL(window.location.href) },
          container,
        )
        container.dataset.mounted = 'true'

        return yield* Effect.never
      }),
    ),
  )

  window.addEventListener(
    'fixture:dispose',
    () => {
      Effect.runFork(
        Fiber.interrupt(fiber).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              container.dataset.disposed = 'true'
            }),
          ),
        ),
      )
    },
    { once: true },
  )
}
