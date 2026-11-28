import { UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Predicate, Schema } from 'effect'
import { expect, it } from 'vitest'

import { browserPageLayer, GetPage } from '../../app/page-query'
import { PlayerFavorite } from '../player/favorite-control'
import { PlayerProvider } from '../player/provider'
import { MembershipButton } from './button'
import {
  audioA,
  document,
  membershipAdapter,
  membershipState,
  page,
  playerLayer,
  receipt,
  runWithLayer,
} from './integration.test-support'
import { MembershipProvider } from './provider'

const RefreshMessage = UiSchema.TaggedEnum({ RequestedPrincipalRefresh: {} })

const RefreshHarness = Html.component({
  name: 'MembershipPrincipalRefreshFixture',
  model: Schema.Struct({ epoch: Schema.Number }),
  message: RefreshMessage,
  queries: {
    page: {
      query: GetPage,
      args: ({ model }) => ({
        realm: 'principal-refresh-fixture',
        path: '/mixes/audio-a',
        identity: { principalId: null, known: false, epoch: model.epoch },
      }),
    },
  },
}).make({
  init: () => ({ epoch: 0 }),
  update: { RequestedPrincipalRefresh: ($) => $.evolve({ epoch: $.model.epoch + 1 }) },
  view: (h) => {
    const verified =
      Predicate.isTagged(h.queries.page, 'Success') && !h.queries.page.waiting
        ? h.queries.page.value
        : undefined

    const principalId = verified?.principal?.id ?? null
    const principalKnown = verified ? verified.principalKnown !== false : false

    return PlayerProvider(h, {
      props: { principalId, principalKnown, returnTo: '/mixes/audio-a' },
      view: () =>
        MembershipProvider(h, {
          props: { principalId, principalKnown },
          onEmit: { RequestedPrincipalRefresh: () => RefreshMessage.RequestedPrincipalRefresh() },
          view: () =>
            h.div.children(
              MembershipButton(h, { props: { document: document() } }),
              PlayerFavorite(h, {}),
            ),
        }),
    })
  },
})

it.each(['page', 'player'])(
  'explicit unknown-principal retry from %s refreshes actual GetPage before loading membership',
  async (consumer) => {
    const recovery = Promise.withResolvers<Response>()
    const reads: Array<string> = []
    const adapter = membershipAdapter(async () => receipt())

    const layer = Layer.mergeAll(
      TestHost.layer(),
      playerLayer,
      adapter.layer,
      browserPageLayer(
        new URL('https://goosebumps.fm'),
        'principal-refresh-fixture',
        async (input) => {
          reads.push(new Request(input).url)

          return reads.length === 1
            ? Response.json(page('/mixes/audio-a', null, audioA, false))
            : recovery.promise
        },
      ),
    )

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RefreshHarness, {})
        yield* TestHost.settle
        expect(adapter.reads).toEqual([])
        expect(reads).toHaveLength(1)
        expect(root.model()?.epoch).toBe(0)
        expect(membershipState(root)).toMatchObject({
          principalKnown: false,
          entries: { 'audio:audio-a': { status: 'unavailable', busy: false } },
        })

        const retry =
          consumer === 'player'
            ? root.get(Locator.attr('aria-label', 'Retry loading favorite'))
            : root.get(Locator.text('Retry saved state'))

        Locator.fire(retry, 'click')
        yield* TestHost.settle
        expect(root.model()?.epoch).toBe(1)
        expect(reads).toHaveLength(2)
        expect(adapter.reads).toEqual([])
        expect(root.text()).not.toContain('Remove from favorites')
        recovery.resolve(Response.json(page('/mixes/audio-a', 'verified-account-a')))
        yield* TestHost.settle
        expect(membershipState(root)).toMatchObject({
          principalId: 'verified-account-a',
          principalKnown: true,
          entries: { 'audio:audio-a': { status: 'inactive', revision: 17, busy: false } },
        })
        expect(adapter.reads).toEqual(['/api/favorites/audio/audio-a/state'])
        expect(root.all(Locator.attr('aria-label', 'Add to favorites'))).toHaveLength(2)
        expect(reads).toHaveLength(2)
        expect(adapter.writes).toEqual([])
      }),
      layer,
    )
  },
)

it('a superseded principal refresh cannot replace independently verified B with a late A page', async () => {
  const old = Promise.withResolvers<Response>()
  const current = Promise.withResolvers<Response>()
  let reads = 0
  const adapter = membershipAdapter(async () => receipt())

  const layer = Layer.mergeAll(
    TestHost.layer(),
    playerLayer,
    adapter.layer,
    browserPageLayer(new URL('https://goosebumps.fm'), 'principal-refresh-fixture', async () => {
      reads += 1

      if (reads === 1) return Response.json(page('/mixes/audio-a', null, audioA, false))

      return reads === 2 ? old.promise : current.promise
    }),
  )

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RefreshHarness, {})
      yield* TestHost.settle
      Locator.fire(root.get(Locator.attr('aria-label', 'Retry loading favorite')), 'click')
      yield* TestHost.settle
      Locator.fire(root.get(Locator.attr('aria-label', 'Retry loading favorite')), 'click')
      yield* TestHost.settle
      expect(root.model()?.epoch).toBe(2)
      expect(adapter.reads).toEqual([])
      current.resolve(Response.json(page('/mixes/audio-a', 'verified-account-b')))
      yield* TestHost.settle
      const verified = membershipState(root)
      expect(verified.principalId).toBe('verified-account-b')
      old.resolve(Response.json(page('/mixes/audio-a', 'late-account-a')))
      yield* TestHost.settle
      expect(membershipState(root)).toEqual(verified)
      expect(adapter.reads).toHaveLength(1)
      expect(adapter.writes).toEqual([])
    }),
    layer,
  )
})

it.each([
  { principalId: null, known: false, status: 'unavailable', membershipReads: 0 },
  { principalId: null, known: true, status: 'anonymous', membershipReads: 0 },
  { principalId: 'independently-verified-b', known: true, status: 'inactive', membershipReads: 1 },
])(
  'recovery uses verified GetPage identity only: $principalId / known $known',
  async ({ principalId, known, status, membershipReads }) => {
    let reads = 0
    const adapter = membershipAdapter(async () => receipt())

    const layer = Layer.mergeAll(
      TestHost.layer(),
      playerLayer,
      adapter.layer,
      browserPageLayer(new URL('https://goosebumps.fm'), 'principal-refresh-fixture', async () => {
        reads += 1

        return Response.json(
          page(
            '/mixes/audio-a',
            reads === 1 ? null : principalId,
            audioA,
            reads === 1 ? false : known,
          ),
        )
      }),
    )

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RefreshHarness, {})
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'Retry loading favorite')), 'click')
        yield* TestHost.settle
        expect(root.model()?.epoch).toBe(1)
        expect(reads).toBe(2)
        expect(adapter.reads).toHaveLength(membershipReads)
        expect(membershipState(root)).toMatchObject({
          principalId,
          principalKnown: known,
          entries: { 'audio:audio-a': { status, busy: false } },
        })
        yield* TestHost.settle
        expect(reads).toBe(2)
        expect(adapter.writes).toEqual([])

        if (!known) {
          Locator.fire(root.get(Locator.attr('aria-label', 'Retry loading favorite')), 'click')
          yield* TestHost.settle
          expect(reads).toBe(3)
          expect(root.model()?.epoch).toBe(2)
          expect(adapter.reads).toEqual([])
        }
      }),
      layer,
    )
  },
)
