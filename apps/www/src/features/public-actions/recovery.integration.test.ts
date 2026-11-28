import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, it } from 'vitest'

import {
  recoveryFixtureBuilder,
  recoveryPublicTrack,
} from '../../../test/membership-recovery.test-support'
import {
  makeReaderLifetimeFixture,
  runReaderLifetime,
} from '../../app/routed-reader-lifetime.test-support'
import { makePlayerClientLayer, PlayerClient } from '../../player/runtime'
import { membershipAdapter, receipt } from './integration.test-support'
import { RecoveryControls, RecoveryControlsMessage } from './recovery-controls.test-support'

const makeRecoveryRootFixture = recoveryFixtureBuilder(
  makeReaderLifetimeFixture,
  makePlayerClientLayer,
)

const accountA = { principalId: 'account-a', principalKnown: true }

const accountB = { principalId: 'account-b', principalKnown: true }

const unknown = { principalId: null, principalKnown: false }

it.each(['load', 'save'])(
  'a current %s401 exposes only safe recovery during unknown and blocks direct mutations, retries and automatic lifecycle reads',
  async (phase) => {
    const adapter = membershipAdapter(
      async () => new Response(null, { status: 401 }),
      phase === 'load' ? async () => new Response(null, { status: 401 }) : undefined,
    )

    const fixture = makeRecoveryRootFixture(
      '/mixes/audio-a',
      async () => {
        throw new Error('No Root page query expected')
      },
      adapter.layer,
    )

    await runReaderLifetime(
      { layer: Layer.merge(fixture.layer, TestClock.layer()) },
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RecoveryControls, accountA)
        yield* TestHost.settle
        const client = yield* PlayerClient
        yield* client.controller.playAll([recoveryPublicTrack])
        yield* TestHost.settle

        if (phase === 'save') {
          const player = root.all(Locator.attr('aria-label', 'Add to favorites')).at(-1)

          if (!player) throw new Error('Missing real player favorite')
          Locator.fire(player, 'click')
          yield* TestHost.settle
        }

        expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(2)
        expect(root.all(Locator.attr('aria-label', 'Sign in to subscribe'))).toHaveLength(1)
        yield* TestClock.adjust('4 seconds')
        yield* TestHost.settle
        expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(2)
        expect(root.all(Locator.attr('aria-label', 'Sign in to subscribe'))).toHaveLength(1)
        root.send(RecoveryControlsMessage.ChangedContext({ context: unknown }))
        yield* TestHost.settle
        const shareText = Locator.textOf(root.get(Locator.attr('data-recovery-share', '')))
        const share: unknown = JSON.parse(shareText)
        expect(share).toMatchObject({
          principalId: null,
          principalKnown: false,
          entries: {},
          revision: null,
          signInRequired: true,
        })
        expect(share).not.toHaveProperty('recoveryOwnerId')
        expect(shareText).not.toContain('account-a')
        expect(shareText).not.toContain('Sign in to continue.')
        expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(2)
        expect(root.get(Locator.attr('aria-label', 'Sign in to subscribe')).attrs?.href).toBe(
          '/auth/sign-in?returnTo=%2Fshows%2Fshow-a',
        )

        root.send(
          RecoveryControlsMessage.ChangedContext({
            context: { ...accountA, lifecycle: { navigationId: 1, pending: true } },
          }),
        )
        yield* TestHost.settle
        const reads = adapter.reads.length
        root.send(
          RecoveryControlsMessage.ChangedContext({
            context: { ...accountA, lifecycle: { navigationId: 1, pending: false } },
          }),
        )

        for (const index of [0, 1, 2, 3])
          Locator.fire(root.get(Locator.attr('data-forward-membership', String(index))), 'click')
        yield* TestHost.settle
        expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(2)
        expect(root.all(Locator.attr('aria-label', 'Add to favorites'))).toHaveLength(0)
        expect(adapter.reads).toHaveLength(reads)
        expect(adapter.writes).toHaveLength(phase === 'save' ? 1 : 0)
      }),
    )
  },
)

it.each([accountB, { principalId: null, principalKnown: true }])(
  'confirmed $principalId clears old recovery and returning A needs a new user intent',
  async (confirmed) => {
    const adapter = membershipAdapter(async () => new Response(null, { status: 401 }))

    const fixture = makeRecoveryRootFixture(
      '/mixes/audio-a',
      async () => {
        throw new Error('No Root page query expected')
      },
      adapter.layer,
    )

    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RecoveryControls, accountA)
        yield* TestHost.settle
        Locator.fire(root.get(Locator.attr('aria-label', 'Add to favorites')), 'click')
        yield* TestHost.settle
        root.send(RecoveryControlsMessage.ChangedContext({ context: unknown }))
        yield* TestHost.settle
        root.send(RecoveryControlsMessage.ChangedContext({ context: confirmed }))
        yield* TestHost.settle

        if (confirmed.principalId === null)
          expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(1)
        else {
          expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(0)
          expect(
            root.get(Locator.attr('aria-label', 'Add to favorites')).attrs?.disabled,
          ).toBeUndefined()
        }

        root.send(RecoveryControlsMessage.ChangedContext({ context: accountA }))
        yield* TestHost.settle
        expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(0)
        expect(
          root.get(Locator.attr('aria-label', 'Add to favorites')).attrs?.disabled,
        ).toBeUndefined()
        expect(adapter.writes).toHaveLength(1)
      }),
    )
  },
)

it('unknown without401 never offers recovery and verified A starts normal inactive controls without a mutation', async () => {
  const adapter = membershipAdapter(async (body) => receipt(body.requestId))

  const fixture = makeRecoveryRootFixture(
    '/mixes/audio-a',
    async () => {
      throw new Error('No Root page query expected')
    },
    adapter.layer,
  )

  await runReaderLifetime(
    fixture,
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RecoveryControls, unknown)
      yield* TestHost.settle
      expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(0)
      expect(root.all(Locator.attr('aria-label', 'Sign in to subscribe'))).toHaveLength(0)
      expect(adapter.reads).toHaveLength(0)
      root.send(RecoveryControlsMessage.ChangedContext({ context: accountA }))
      yield* TestHost.settle
      expect(
        root.get(Locator.attr('aria-label', 'Add to favorites')).attrs?.disabled,
      ).toBeUndefined()
      expect(adapter.writes).toHaveLength(0)
    }),
  )
})

it.each([
  { phase: 'load', arrival: 'B' },
  { phase: 'load', arrival: 'new A generation' },
  { phase: 'save', arrival: 'B' },
  { phase: 'save', arrival: 'new A generation' },
])('a held old A $phase 401 cannot latch recovery in $arrival', async ({ phase, arrival }) => {
  const denied = Promise.withResolvers<Response>()
  let reads = 0

  const adapter = membershipAdapter(
    () => denied.promise,
    async (url) => {
      if (phase === 'load' && url.includes('/audio/') && ++reads === 1) return denied.promise

      return Response.json({ revision: 17, favorited: false, subscribed: false })
    },
  )

  const fixture = makeRecoveryRootFixture(
    '/mixes/audio-a',
    async () => {
      throw new Error('No Root page query expected')
    },
    adapter.layer,
  )

  await runReaderLifetime(
    fixture,
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RecoveryControls, accountA)
      yield* TestHost.settle

      if (phase === 'save') {
        Locator.fire(root.get(Locator.attr('aria-label', 'Add to favorites')), 'click')
        yield* TestHost.settle
      }

      expect(adapter.writes).toHaveLength(phase === 'save' ? 1 : 0)
      root.send(RecoveryControlsMessage.ChangedContext({ context: accountB }))
      yield* TestHost.settle

      if (arrival === 'new A generation') {
        root.send(RecoveryControlsMessage.ChangedContext({ context: accountA }))
        yield* TestHost.settle
      }

      denied.resolve(new Response(null, { status: 401 }))
      yield* TestHost.settle
      expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(0)
      expect(root.all(Locator.attr('aria-label', 'Sign in to subscribe'))).toHaveLength(0)
      expect(
        root.get(Locator.attr('aria-label', 'Add to favorites')).attrs?.disabled,
      ).toBeUndefined()
      expect(adapter.writes).toHaveLength(phase === 'save' ? 1 : 0)
    }),
  )
})

it('a new document resets recovery but only a new explicit intent can write with a fresh mutation ID', async () => {
  let attempts = 0

  const adapter = membershipAdapter(async (body) =>
    ++attempts === 1 ? new Response(null, { status: 401 }) : receipt(body.requestId),
  )

  const makeFixture = () =>
    makeRecoveryRootFixture(
      '/mixes/audio-a',
      async () => {
        throw new Error('No Root page query expected')
      },
      adapter.layer,
    )

  await runReaderLifetime(
    makeFixture(),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RecoveryControls, accountA)
      yield* TestHost.settle
      Locator.fire(root.get(Locator.attr('aria-label', 'Add to favorites')), 'click')
      yield* TestHost.settle
      expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(1)
      expect(adapter.writes).toHaveLength(1)
    }),
  )
  await runReaderLifetime(
    makeFixture(),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RecoveryControls, accountA)
      yield* TestHost.settle
      expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(0)
      expect(adapter.writes).toHaveLength(1)
      Locator.fire(root.get(Locator.attr('aria-label', 'Add to favorites')), 'click')
      yield* TestHost.settle
      expect(adapter.writes).toHaveLength(2)
      const ids = adapter.writes.map((body) => body.requestId)
      expect(new Set(ids).size).toBe(2)
      expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(1)
    }),
  )
})
