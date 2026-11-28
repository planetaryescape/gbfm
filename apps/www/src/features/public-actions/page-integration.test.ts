import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Predicate } from 'effect'
import { expect, it } from 'vitest'

import { GetPage } from '../../app/page-query'
import { RoutedApplicationNoDeps } from '../../app/routed-application'
import {
  bootstrap,
  membershipAdapter,
  membershipState,
  mutationId,
  page,
  receipt,
  rootLayer,
  runWithLayer,
} from './integration.test-support'

it('native GetPage loading and its stale DTO cannot discard or undo an acknowledged player membership write', async () => {
  const read = Promise.withResolvers<Response>()
  const save = Promise.withResolvers<Response>()
  const adapter = membershipAdapter(() => save.promise)

  const layer = rootLayer(async (input) => {
    const url = new URL(new Request(input).url)

    return url.searchParams.has('late') ? read.promise : Response.json(page('/mixes/audio-a'))
  }, adapter.layer)

  await runWithLayer(
    Effect.gen(function* () {
      const router = yield* Router.Router
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
      yield* TestHost.settle

      const nowPlaying = root
        .all(Locator.attr('aria-label', 'Now playing'))
        .find((node) => Predicate.isTagged(node, 'Element') && node.tag === 'button')

      if (!nowPlaying) throw new Error('Missing native player opener')
      Locator.fire(nowPlaying, 'click')
      yield* TestHost.settle
      const controls = root.all(Locator.attr('aria-label', 'Add to favorites'))
      const player = controls.at(-1)

      if (!player) throw new Error('Missing native player favorite')
      Locator.fire(player, 'click')
      yield* TestHost.settle
      const pending = membershipState(root)
      expect(pending.entries['audio:audio-a']).toMatchObject({ busy: true, revision: 17 })
      expect(adapter.writes).toEqual([
        { requestId: mutationId, expectedRevision: 17, audioId: 'audio-a' },
      ])
      yield* router.navigate('/mixes/audio-a?late=1')
      yield* TestHost.settle
      expect(membershipState(root)).toEqual(pending)
      save.resolve(receipt())
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'active',
        revision: 18,
        busy: false,
      })
      read.resolve(Response.json(page('/mixes/audio-a?late=1')))
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'active',
        revision: 18,
      })
      expect(
        root.all(Locator.attr('aria-label', 'Remove from favorites')).length,
      ).toBeGreaterThanOrEqual(2)
      const model = root.model()

      if (!model) throw new Error('Native routed root crashed')

      const cache = root.entry(GetPage, {
        path: '/mixes/audio-a?late=1',
        identity: model.identity,
        realm: bootstrap().realm,
      })

      if (!cache || !Predicate.isTagged(cache.stored, 'Success'))
        throw new Error('Missing native GetPage cache snapshot')
      expect(cache.stored.value.publicAction?.state).toBe('inactive')
      expect(adapter.reads).toHaveLength(1)
    }),
    layer,
  )
})

it('real-root explicit unknown favorite retry refreshes GetPage identity before any membership API read', async () => {
  const recovered = Promise.withResolvers<Response>()
  let pageReads = 0
  const adapter = membershipAdapter(async () => receipt())

  const layer = rootLayer(async () => {
    pageReads += 1

    return pageReads === 1
      ? Response.json(page('/mixes/audio-a', null, undefined, false))
      : recovered.promise
  }, adapter.layer)

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, {
        ...bootstrap(),
        identity: { principalId: null, known: false, epoch: 0 },
      })

      yield* TestHost.settle

      const opener = root
        .all(Locator.attr('aria-label', 'Now playing'))
        .find((node) => Predicate.isTagged(node, 'Element') && node.tag === 'button')

      if (!opener) throw new Error('Missing native player opener')
      Locator.fire(opener, 'click')
      yield* TestHost.settle
      expect(membershipState(root)).toMatchObject({
        principalId: null,
        principalKnown: false,
        entries: { 'audio:audio-a': { status: 'unavailable', busy: false } },
      })
      expect(pageReads).toBe(1)
      expect(adapter.reads).toEqual([])
      Locator.fire(root.get(Locator.attr('aria-label', 'Retry loading favorite')), 'click')
      yield* TestHost.settle
      expect(pageReads).toBeGreaterThan(1)
      expect(adapter.reads).toEqual([])
      recovered.resolve(Response.json(page('/mixes/audio-a', 'verified-root-account')))
      yield* TestHost.settle
      expect(membershipState(root)).toMatchObject({
        principalId: 'verified-root-account',
        principalKnown: true,
        entries: { 'audio:audio-a': { status: 'inactive', revision: 17, busy: false } },
      })
      expect(
        root.all(Locator.attr('aria-label', 'Add to favorites')).length,
      ).toBeGreaterThanOrEqual(2)
      expect(adapter.reads).toHaveLength(1)
      const settledReads = pageReads
      yield* TestHost.settle
      expect(pageReads).toBe(settledReads)
      expect(adapter.writes).toEqual([])
    }),
    layer,
  )
})

it('a later native GetPage observation obtains a fresh atomic revision even when its DTO matches the cached boolean', async () => {
  let reads = 0

  const adapter = membershipAdapter(
    async () => receipt(),
    async () => {
      reads += 1

      return Response.json({ revision: reads === 1 ? 17 : 19, favorited: false, subscribed: false })
    },
  )

  const layer = rootLayer(async (input) => {
    const url = new URL(new Request(input).url)
    url.searchParams.delete('__data')

    return Response.json(page(`${url.pathname}${url.search}`))
  }, adapter.layer)

  await runWithLayer(
    Effect.gen(function* () {
      const router = yield* Router.Router
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
      yield* TestHost.settle
      const pageControl = root.all(Locator.attr('aria-label', 'Add to favorites'))[0]

      if (!pageControl) throw new Error('Missing native page membership control')
      Locator.fire(pageControl, 'click')
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'active',
        revision: 18,
      })
      yield* router.navigate('/mixes/audio-a?fresh=1')
      yield* TestHost.settle
      expect(adapter.reads).toHaveLength(2)
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'inactive',
        revision: 19,
      })
      expect(root.all(Locator.attr('aria-label', 'Add to favorites')).length).toBeGreaterThan(0)
    }),
    layer,
  )
})
