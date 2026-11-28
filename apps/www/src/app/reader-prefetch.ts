import { Component, Subscription, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Effect, Schema, Stream } from 'effect'

import type { PageDocument } from '../domain/page'
import { concreteSlug, parseCheckpoint } from '../features/reader/location'
import { GetPage, PageQueryArgs, type PageIdentity } from './page-query'
import { canPrefetchPage } from './route'

export const readerNeighbourPageArgs = (
  page: PageDocument | undefined,
  url: URL,
  identity: PageIdentity,
  realm: string,
): ReadonlyArray<PageQueryArgs> => {
  if (!page || !canPrefetchPage(url, identity)) return []
  const source = URL.parse(page.url)
  const slug = concreteSlug(url)

  if (
    source?.origin !== url.origin ||
    `${source.pathname}${source.search}` !== `${url.pathname}${url.search}` ||
    !slug ||
    page.tweet?.post.slug !== slug ||
    !page.neighbours
  )
    return []

  const paths = [...new Set([page.neighbours.older, page.neighbours.newer])].flatMap((value) => {
    const target = parseCheckpoint(value)

    return target !== null && target !== slug ? [`/tweet/${encodeURIComponent(target)}`] : []
  })

  return paths.map((path) => ({ path, identity, realm }))
}

const ReaderNeighbourPrefetchMessage = UiSchema.TaggedEnum({
  StartedReaderPrefetch: {},
})

export const ReaderNeighbourPrefetch = Html.component({
  name: 'ReaderNeighbourPrefetch',
  props: Schema.Struct({ pages: Schema.Array(PageQueryArgs) }),
  model: Schema.Boolean,
  message: ReaderNeighbourPrefetchMessage,
  restore: false,
  queries: {
    neighbours: {
      queryMany: GetPage,
      args: ({ model, props }) => (model ? props.pages : []),
    },
  },
})
  .make({
    init: () => false,
    subscriptions: ({ model }) => [
      !model &&
        Subscription.make(
          'reader-prefetch-started',
          Stream.succeed(ReaderNeighbourPrefetchMessage.StartedReaderPrefetch()),
        ),
    ],
    update: {
      StartedReaderPrefetch: () => true,
    },
    view: (h) => h.text(''),
  })
  .pipe(
    Component.provide(
      GetPage.toLayer(Effect.map(GetPage, (fetchPage) => (args) => fetchPage(args))),
    ),
  )
