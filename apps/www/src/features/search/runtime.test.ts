import { Component, Router, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import type { SearchResults } from '@gbfm/api/search'
import { Effect, Layer, Predicate, Schema, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, it } from 'vitest'

import { AppRoute } from '../../app/route'
import { PerformPlayer } from '../player/commands'
import { initialSnapshot } from '../player/domain'
import { PlayerProvider } from '../player/provider'
import { PlayerSnapshotSource } from '../player/subscriptions'
import { runWithLayer } from '../player/testing'
import { NavigateSearch, SearchCatalog, SearchDialogNoDeps } from './dialog'
import { SearchQueryScope } from './scope'

const scope = {
  realm: 'search-runtime',
  principalId: 'account-a',
  known: true,
  epoch: 0,
  origin: 'https://goosebumps.fm',
}

const HarnessMessage = UiSchema.TaggedEnum({
  ChangedScope: { queryScope: SearchQueryScope },
  Closed: {},
})

const Harness = Html.component({
  name: 'SearchRuntimeHarness',
  model: Schema.Struct({ open: Schema.Boolean, queryScope: SearchQueryScope }),
  message: HarnessMessage,
}).make({
  init: () => ({ open: true, queryScope: scope }),
  update: {
    ChangedScope: ($, { queryScope }) => $.evolve({ queryScope }),
    Closed: ($) => $.evolve({ open: false }),
  },
  view: (h, model) =>
    PlayerProvider(h, {
      props: {
        principalId: model.queryScope.principalId,
        principalKnown: model.queryScope.known,
        returnTo: '/',
      },
      view: () =>
        SearchDialogNoDeps(h, {
          props: { open: model.open, queryScope: model.queryScope },
          onEmit: { RequestedClose: () => HarnessMessage.Closed(), RequestedOpen: () => undefined },
        }),
    }),
})

const results = (title: string): typeof SearchResults.Type => ({
  shows: [{ id: title, slug: title, title, type: 'show', thumbnailUrl: null, description: null }],
  audio: [],
  posts: [],
})

const NavigationHarness = Html.component({
  name: 'SearchNavigationHarness',
  props: Schema.Struct({ href: Schema.String }),
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: ($) => $.set(null).run(NavigateSearch.make({ href: $.props.href, origin: scope.origin })),
  update: ($) => $.model,
  view: (h) => h.text(''),
})

it.each([
  '/auth/reset-password?token=fixture',
  '/auth/verify-email?token=fixture',
  '/actions/favorite',
  '/connect/spotify',
  'https://external.example/shows/fixture',
])('search navigation preserves a full HTTP load for %s', async (href) => {
  const history = Router.memoryHistory('/about')

  const layer = Layer.merge(
    TestHost.layer(),
    NavigateSearch.layer.pipe(Layer.provideMerge(Router.memory({ routes: AppRoute, history }))),
  )

  await runWithLayer(
    layer,
    Effect.gen(function* () {
      yield* TestHost.mount(NavigationHarness, { href })
      yield* TestHost.settle
      expect(history.loaded()).toEqual([new URL(href, scope.origin).href])
      expect(history.entries()).toEqual(['/about'])
    }),
  )
})

const typeQuery = (root: TestHost.TestRoot<unknown, never, unknown>, query: string) => {
  const input = root.get(Locator.attr('aria-label', 'Search query'))

  if (!Predicate.isTagged(input, 'Element')) throw new Error('Missing search input')
  input.props.value = query
  Locator.fire(input, 'input', { value: query })
}

it.each(['click', 'Enter'])(
  '%s selection navigates the memory Router without hard load or remounting the mounted player',
  async (selection) => {
    let starts = 0
    const history = Router.memoryHistory('/about')

    const layer = Layer.mergeAll(
      TestHost.layer(),
      TestClock.layer(),
      NavigateSearch.layer.pipe(Layer.provideMerge(Router.memory({ routes: AppRoute, history }))),
      SearchCatalog.toLayer(() => Effect.succeed(results('fixture-show'))),
      PerformPlayer.toLayer(() => Effect.succeed(Component.noop)),
      Layer.succeed(PlayerSnapshotSource, {
        snapshots: Stream.fromEffect(
          Effect.sync(() => {
            starts += 1

            return initialSnapshot
          }),
        ),
      }),
    )

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(Harness, {})
        yield* TestHost.settle
        typeQuery(root, 'fixture')
        yield* TestHost.settle
        yield* TestClock.adjust('250 millis')
        yield* TestHost.settle

        if (selection === 'click')
          Locator.fire(root.get(Locator.tag('a')), 'click', {
            button: 0,
            ctrl: false,
            meta: false,
            shift: false,
            alt: false,
          })
        else Locator.fire(root.get(Locator.attr('role', 'search')), 'submit')
        yield* TestHost.settle
        expect(router.location().url).toBe('/shows/fixture-show')
        expect(history.loaded()).toEqual([])
        expect(root.model()?.open).toBe(false)
        expect(starts).toBe(1)
        expect(
          root
            .log()
            .filter(
              (entry) =>
                Predicate.isTagged(entry, 'Mounted') && entry.path.endsWith('/PlayerProvider[]'),
            ),
        ).toHaveLength(1)
      }),
    )
  },
)

it.each([false, true])(
  'account A results cannot display or warm the same query under B or unknown identity, delayed: %s',
  async (delayed) => {
    const late = Promise.withResolvers<typeof SearchResults.Type>()
    const requests: Array<SearchQueryScope> = []

    const layer = Layer.mergeAll(
      TestHost.layer(),
      TestClock.layer(),
      NavigateSearch.layer.pipe(
        Layer.provideMerge(Router.memory({ routes: AppRoute, url: '/about' })),
      ),
      SearchCatalog.toLayer(({ queryScope }) => {
        requests.push(queryScope)

        if (queryScope.principalId !== 'account-a') return Effect.succeed(results('B-only'))

        return delayed ? Effect.promise(() => late.promise) : Effect.succeed(results('A-private'))
      }),
      PerformPlayer.toLayer(() => Effect.succeed(Component.noop)),
      Layer.succeed(PlayerSnapshotSource, { snapshots: Stream.succeed(initialSnapshot) }),
    )

    await runWithLayer(
      layer,
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(Harness, {})
        yield* TestHost.settle
        typeQuery(root, 'same')
        yield* TestHost.settle
        yield* TestClock.adjust('250 millis')
        yield* TestHost.settle
        expect(requests).toHaveLength(1)

        if (!delayed) expect(root.text()).toContain('A-private')
        root.send(
          HarnessMessage.ChangedScope({
            queryScope: { ...scope, principalId: 'account-b', epoch: 1 },
          }),
        )
        yield* TestHost.settle
        expect(root.text()).not.toContain('A-private')
        typeQuery(root, 'same')
        yield* TestHost.settle
        yield* TestClock.adjust('250 millis')
        yield* TestHost.settle
        expect(root.text()).toContain('B-only')
        late.resolve(results('A-private'))
        yield* TestHost.settle
        expect(root.text()).not.toContain('A-private')
        expect(root.text()).toContain('B-only')
        expect(requests.map((request) => request.principalId)).toEqual(['account-a', 'account-b'])
        root.send(
          HarnessMessage.ChangedScope({
            queryScope: { ...scope, principalId: null, known: false, epoch: 2 },
          }),
        )
        yield* TestHost.settle
        expect(root.text()).not.toContain('B-only')
        typeQuery(root, 'same')
        yield* TestHost.settle
        yield* TestClock.adjust('250 millis')
        yield* TestHost.settle
        expect(requests).toHaveLength(2)
        expect(router.location().url).toBe('/about')
      }),
    )
  },
)
