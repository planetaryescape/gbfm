import { Component, Head, Query } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { parseRichContent } from '@gbfm/rich-content/source'
import { Context, Effect, Predicate, Schema } from 'effect'

export class FixtureIdentity extends Context.Service<
  FixtureIdentity,
  { readonly read: Effect.Effect<string> }
>()('gbfm/test/FixtureIdentity') {}

class GetFixtureIdentity extends Query.Service<GetFixtureIdentity>()(
  'gbfm/test/GetFixtureIdentity',
  {
    args: {},
    success: Schema.String,
    error: Schema.Never,
    staleTime: 'Infinity',
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const identity = yield* FixtureIdentity

      return () => identity.read
    }),
  )
}

const Identity = Html.component({
  name: 'FixtureIdentity',
  model: Schema.Null,
  message: Schema.Never,
  queries: { identity: { query: GetFixtureIdentity, args: () => ({}) } },
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) => {
    const identity = h.queries.identity

    return h.p(Predicate.isTagged(identity, 'Success') ? identity.value : 'Loading identity')
  },
})

const workerDocument = parseRichContent('Worker-safe **markdown** &amp; entities').document

export const FixtureProps = Schema.Struct({ title: Schema.String })

export const FixtureApp = Html.component({
  name: 'FixtureApp',
  props: FixtureProps,
  model: Schema.Struct({ clicks: Schema.Number }),
  message: Schema.Literal('ClickedIncrement'),
})
  .make({
    init: () => ({ clicks: 0 }),
    update: ($) => $.evolve({ clicks: (clicks) => clicks + 1 }),
    head: ({ props }) => [Head.title(props.title)],
    view: (h, model) =>
      h.main
        .class('font-jetbrains')
        .children(
          h.h1(h.props.title),
          h.p
            .attr('data-worker-markdown', '')
            .children(`Worker markdown blocks: ${workerDocument.blocks.length}`),
          Identity(h, { key: 'first' }),
          Identity(h, { key: 'second' }),
          h.button.on('click', 'ClickedIncrement').children(`Clicks: ${model.clicks}`),
        ),
  })
  .pipe(Component.provide(GetFixtureIdentity.layer))
