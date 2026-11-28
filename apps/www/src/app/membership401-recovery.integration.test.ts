import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Predicate } from 'effect'
import { expect, it } from 'vitest'

import {
  recoveryFixtureBuilder,
  recoveryPage,
  recoveryPrivateTrack,
  recoveryPublicTrack,
} from '../../test/membership-recovery.test-support'
import {
  membershipAdapter,
  membershipState,
} from '../features/public-actions/integration.test-support'
import { openRetirementPlayer } from '../features/public-actions/retirement.test-support'
import { makePlayerClientLayer, PlayerClient } from '../player/runtime'
import { RoutedApplicationNoDeps } from './routed-application'
import { makeReaderLifetimeFixture, runReaderLifetime } from './routed-reader-lifetime.test-support'

const makeRecoveryRootFixture = recoveryFixtureBuilder(
  makeReaderLifetimeFixture,
  makePlayerClientLayer,
)

it('a current atomic read401 refreshes Root once without an automatic membership-read401 loop', async () => {
  let pages = 0

  const adapter = membershipAdapter(
    async () => {
      throw new Error('No write expected during authorization recovery')
    },
    async () => new Response(null, { status: 401 }),
  )

  const fixture = makeRecoveryRootFixture(
    '/mixes/audio-a',
    async () => {
      if (++pages > 2) throw new Error('Automatic Root refresh loop')

      return Response.json(recoveryPage())
    },
    adapter.layer,
  )

  await runReaderLifetime(
    fixture,
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
      yield* TestHost.settle
      expect(pages).toBe(2)
      expect(adapter.reads).toHaveLength(1)
      expect(adapter.writes).toHaveLength(0)
      expect(root.model()?.membershipPrincipalKnown).toBe(true)
      expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(1)
      yield* TestHost.settle
      expect(pages).toBe(2)
      expect(adapter.reads).toHaveLength(1)
      expect(adapter.writes).toHaveLength(0)
    }),
  )
})

it.each([
  {
    kind: 'favorite',
    path: '/mixes/audio-a',
    button: 'Add to favorites',
    link: 'Sign in to favorite',
  },
  { kind: 'subscribe', path: '/shows/show-a', button: 'Subscribe', link: 'Sign in to subscribe' },
])(
  'a current $kind write401 keeps recovery through held verification and independently verified same-A refresh',
  async ({ path, button, link }) => {
    const refresh = Promise.withResolvers<Response>()
    let pages = 0
    const adapter = membershipAdapter(async () => new Response(null, { status: 401 }))

    const fixture = makeRecoveryRootFixture(
      path,
      async (input) => {
        pages++
        const url = new URL(new Request(input).url)
        url.searchParams.delete('__data')
        const currentPath = `${url.pathname}${url.search}`

        if (pages === 2) return refresh.promise

        return Response.json(recoveryPage(pages === 1 ? path : currentPath))
      },
      adapter.layer,
    )

    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        const client = yield* PlayerClient
        yield* client.controller.playAll([recoveryPublicTrack])
        yield* TestHost.settle
        yield* openRetirementPlayer(root)

        const control = root
          .all(Locator.attr('aria-label', button))
          .find((node) => Predicate.isTagged(node, 'Element') && node.tag === 'button')

        if (!control) throw new Error(`Missing ${button}`)
        Locator.fire(control, 'click')
        yield* TestHost.settle
        expect(adapter.writes).toHaveLength(1)
        expect(pages).toBe(2)
        expect(root.model()?.membershipPrincipalKnown).toBe(false)
        expect(root.model()?.membershipPrincipalId).toBeNull()
        expect
          .soft(root.all(Locator.attr('aria-label', 'Sign in to favorite')).length)
          .toBeGreaterThan(0)

        refresh.resolve(Response.json(recoveryPage(path)))
        yield* TestHost.settle
        expect(root.model()?.membershipPrincipalKnown).toBe(true)
        expect(root.model()?.membershipPrincipalId).toBe('account-a')
        expect.soft(root.all(Locator.attr('aria-label', link)).length).toBeGreaterThan(0)
        expect.soft(root.all(Locator.attr('aria-label', button))).toHaveLength(0)
        const reads = adapter.reads.length
        const settledPages = pages
        yield* TestHost.settle
        expect(adapter.writes).toHaveLength(1)
        expect(adapter.reads).toHaveLength(reads)
        expect(pages).toBe(settledPages)
        const router = yield* Router.Router
        yield* router.navigate(`${path}?verified=again`)
        yield* TestHost.settle
        expect(root.model()?.membershipPrincipalKnown).toBe(true)
        expect.soft(root.all(Locator.attr('aria-label', link)).length).toBeGreaterThan(0)
        expect.soft(root.all(Locator.attr('aria-label', button))).toHaveLength(0)
        expect(adapter.writes).toHaveLength(1)
        expect(
          Object.values(membershipState(root).entries).every((entry) => entry.status !== 'active'),
        ).toBe(true)
      }),
    )
  },
)

it('sticky public recovery cannot reveal or regrant private current, queue, artwork or Media Session after same-A verification', async () => {
  const refresh = Promise.withResolvers<Response>()
  let pages = 0
  const adapter = membershipAdapter(async () => new Response(null, { status: 401 }))

  const fixture = makeRecoveryRootFixture(
    '/mixes/audio-a',
    async () => (++pages === 1 ? Response.json(recoveryPage()) : refresh.promise),
    adapter.layer,
  )

  const queued = {
    ...recoveryPrivateTrack,
    id: 'private-recovery-queued',
    slug: 'private-recovery-queued',
    title: 'Private queued recovery title',
    url: 'https://cdn.fixture.test/user-content/private/account-a/audio/queued.mp3',
  }

  await runReaderLifetime(
    fixture,
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
      yield* TestHost.settle
      const client = yield* PlayerClient

      if (!client.privateAccess) throw new Error('Missing real private authorization service')
      yield* client.controller.playAll([queued])
      yield* TestHost.settle
      yield* client.controller.playAll([recoveryPrivateTrack, queued])
      yield* TestHost.settle
      yield* openRetirementPlayer(root)

      const queue = root
        .all(Locator.tag('button'))
        .find(
          (node) =>
            Predicate.isTagged(node, 'Element') && node.attrs['aria-label']?.startsWith('Queue ('),
        )

      if (!queue) throw new Error('Missing real queue control')
      Locator.fire(queue, 'click')
      yield* TestHost.settle
      expect(root.text()).toContain(recoveryPrivateTrack.title)
      expect(root.text()).toContain(queued.title)
      expect(fixture.metadata.at(-1)?.title).toBe(recoveryPrivateTrack.title)
      const grants = fixture.grants()
      expect(grants).toBeGreaterThan(0)

      const pageControl = Locator.attr('aria-label', 'Add to favorites')
        .all(root.get(Locator.tag('main')))
        .at(0)

      if (!pageControl) throw new Error('Missing public page favorite')
      Locator.fire(pageControl, 'click')
      yield* TestHost.settle
      expect(root.model()?.membershipPrincipalKnown).toBe(false)
      expect(root.text()).not.toContain(recoveryPrivateTrack.title)
      expect(root.text()).not.toContain(queued.title)
      expect(fixture.metadata.at(-1)).toBeNull()
      expect(client.privateAccess.getSnapshot().authorizedUrls).toEqual([])
      expect(
        fixture.audio.every(
          (audio) => audio.src !== recoveryPrivateTrack.url && audio.src !== queued.url,
        ),
      ).toBe(true)
      expect(
        root
          .all(Locator.tag('img'))
          .flatMap((node) => (Predicate.isTagged(node, 'Element') ? [node.attrs.src] : [])),
      ).not.toContain(recoveryPrivateTrack.thumbnailUrl)
      refresh.resolve(Response.json(recoveryPage()))
      yield* TestHost.settle
      expect(root.model()?.membershipPrincipalKnown).toBe(true)
      expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(1)
      expect(root.text()).not.toContain(recoveryPrivateTrack.title)
      expect(root.text()).not.toContain(queued.title)
      expect(fixture.metadata.at(-1)).toBeNull()
      expect(client.privateAccess.getSnapshot().authorizedUrls).toEqual([])
      expect(client.controller.getSnapshot().queue.tracks).toHaveLength(0)
      expect(fixture.grants()).toBe(grants)
      expect(adapter.writes).toHaveLength(1)
    }),
  )
})
