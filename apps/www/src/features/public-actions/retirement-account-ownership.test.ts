import { Locator, Story, TestHost } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { expect, it } from 'vitest'

import { LoadMembership, SaveMembership } from './commands'
import {
  audioA,
  control,
  controlsContext,
  IntegrationContextMessage,
  listener,
  MembershipControls,
  membershipAdapter,
  membershipState,
  mutationId,
  playerLayer,
  receipt,
  runWithLayer,
} from './integration.test-support'
import { MembershipMessage as M } from './provider'
import {
  atomicStateResponse,
  playerNotice,
  RetirementMembershipState,
} from './retirement.test-support'

it.each([
  { phase: 'load', result: 'saved' },
  { phase: 'load', result: 'unauthorized' },
  { phase: 'load', result: 'lost' },
  { phase: 'save', result: 'saved' },
  { phase: 'save', result: 'unauthorized' },
  { phase: 'save', result: 'lost' },
])(
  'a stale $phase $result cannot settle a different-account or later same-account observation still loading',
  async ({ phase, result }) => {
    const old = Promise.withResolvers<Response>()
    const current = Promise.withResolvers<void>()
    let reads = 0

    const adapter = membershipAdapter(
      async () => old.promise,
      async () => {
        reads++

        if (reads === 1) return phase === 'load' ? old.promise : atomicStateResponse(17)
        await current.promise

        return atomicStateResponse(22, true)
      },
    )

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, controlsContext)
        yield* TestHost.settle

        if (phase === 'save') {
          Locator.fire(control(root, 'player'), 'click')
          yield* TestHost.settle
        }

        const first = membershipState(root)
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...controlsContext, principalId: 'account-b' },
          }),
        )
        yield* TestHost.settle
        expect(membershipState(root)).toMatchObject({
          principalId: 'account-b',
          entries: { 'audio:audio-a': { busy: true, revision: null, status: 'loading' } },
        })
        root.send(IntegrationContextMessage.ChangedContext({ context: controlsContext }))
        yield* TestHost.settle
        const pending = membershipState(root)
        expect(pending.generation).toBeGreaterThan(first.generation)
        expect(pending.entries['audio:audio-a']).toMatchObject({
          busy: true,
          status: 'loading',
          revision: null,
        })

        if (result === 'saved') {
          old.resolve(phase === 'load' ? atomicStateResponse(18, true) : receipt())
        } else old.resolve(new Response(null, { status: result === 'unauthorized' ? 401 : 503 }))
        yield* TestHost.settle
        expect(membershipState(root)).toEqual(pending)
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
        expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(0)
        expect(playerNotice(root)).toBe('')
        current.resolve()
        yield* TestHost.settle
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'active',
          busy: false,
          revision: 22,
          mutationId: null,
        })
        expect(control(root, audioA.id).attrs?.['aria-pressed']).toBe('true')
        expect(control(root, 'player').attrs?.['aria-pressed']).toBe('true')
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)

it.each(['load', 'save'])(
  'confirmed sign-out invalidates an old %s and never permits a later stale account acknowledgement to restore private favorite state',
  async (phase) => {
    const old = Promise.withResolvers<Response>()

    const adapter = membershipAdapter(
      async () => old.promise,
      phase === 'load' ? async () => old.promise : undefined,
    )

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, controlsContext)
        yield* TestHost.settle

        if (phase === 'save') {
          Locator.fire(control(root, 'player'), 'click')
          yield* TestHost.settle
        }

        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...controlsContext, principalId: null, principalKnown: true },
          }),
        )
        yield* TestHost.settle
        const anonymous = membershipState(root)
        expect(anonymous.entries['audio:audio-a']).toMatchObject({
          status: 'anonymous',
          busy: false,
          mutationId: null,
          revision: null,
        })
        old.resolve(phase === 'load' ? atomicStateResponse(18, true) : receipt())
        yield* TestHost.settle
        expect(membershipState(root)).toEqual(anonymous)
        expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(2)
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
        expect(adapter.reads).toHaveLength(1)
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)

it.each(['Saved', 'Failed'])(
  'an old page %s cannot settle the pending B write or a newer A write after B acknowledgement and external removal',
  (result) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(RetirementMembershipState, listener)

          const oldOwner = {
            target: audioA,
            principalId: listener.principalId,
            generation: 0,
            request: 2,
          }

          const oldWrite = SaveMembership.make({
            ...oldOwner,
            active: true,
            expectedRevision: 17,
            mutationId: null,
          })

          const oldResult =
            result === 'Saved'
              ? M.SucceededSaveMembership({ ...oldOwner, active: true, revision: 18 })
              : M.FailedSaveMembership({
                  ...oldOwner,
                  unauthorized: true,
                  conflicted: false,
                  mutationId,
                })

          s.send(M.RequestedMembership({ target: audioA }))
            .resolve(
              LoadMembership,
              M.SucceededLoadMembership({
                ...oldOwner,
                request: 1,
                active: false,
                revision: 17,
              }),
            )
            .send(M.RequestedToggleMembership({ target: audioA }))
            .expectExact(oldWrite)
            .keepPending(oldWrite)
          s.props({ principalId: 'account-b', principalKnown: true })
            .send(M.ChangedPrincipal({ principalId: 'account-b', principalKnown: true }))
            .expectExact(oldWrite)
            .keepPending(oldWrite)
          const nextOwner = { ...oldOwner, principalId: 'account-b', generation: 1 }

          const nextWrite = SaveMembership.make({
            ...nextOwner,
            active: true,
            expectedRevision: 17,
            mutationId: null,
          })

          s.send(M.RequestedMembership({ target: audioA }))
            .resolve(
              LoadMembership,
              M.SucceededLoadMembership({
                ...nextOwner,
                request: 1,
                active: false,
                revision: 17,
              }),
            )
            .expectExact(oldWrite)
            .keepPending(oldWrite)
            .send(M.RequestedToggleMembership({ target: audioA }))
            .expectExact(oldWrite, nextWrite)
            .keepPending(oldWrite)
            .keepPending(nextWrite)
          const pendingB = s.model

          s.resolve(oldWrite, oldResult).expectExact(nextWrite).keepPending(nextWrite)
          expect(s.model).toBe(pendingB)
          s.resolve(
            nextWrite,
            M.SucceededSaveMembership({
              ...nextOwner,
              active: true,
              revision: 18,
            }),
          ).expectNone()
          expect(s.model).toMatchObject({
            principalId: 'account-b',
            entries: { 'audio:audio-a': { status: 'active', revision: 18, busy: false } },
          })
          s.props({
            principalId: 'account-b',
            principalKnown: true,
            lifecycle: { navigationId: 1, pending: true },
          })
            .send(M.ChangedMembershipLifecycle())
            .expectNone()
          s.props({
            principalId: 'account-b',
            principalKnown: true,
            lifecycle: { navigationId: 1, pending: false },
          })
            .send(M.ChangedMembershipLifecycle())
            .resolve(
              LoadMembership,
              M.SucceededLoadMembership({
                ...nextOwner,
                request: 3,
                active: false,
                revision: 19,
              }),
            )
            .expectNone()
          expect(s.model.entries['audio:audio-a']).toMatchObject({
            status: 'inactive',
            revision: 19,
            busy: false,
          })
          s.props(listener).send(M.ChangedPrincipal(listener)).expectNone()
          s.send(M.RequestedMembership({ target: audioA }))
            .resolve(
              LoadMembership,
              M.SucceededLoadMembership({
                ...oldOwner,
                generation: 2,
                request: 1,
                active: false,
                revision: 19,
              }),
            )
            .send(M.RequestedToggleMembership({ target: audioA }))
            .expectExact(SaveMembership)
            .keepPending(SaveMembership)
          const pendingA = s.model

          s.send(oldResult).expectExact(SaveMembership)
          expect(s.model).toBe(pendingA)
          expect(s.model.entries['audio:audio-a']).toMatchObject({
            busy: true,
            status: 'inactive',
            revision: 19,
          })
          s.resolve(
            SaveMembership,
            M.SucceededSaveMembership({
              ...oldOwner,
              generation: 2,
              active: true,
              revision: 20,
            }),
          ).expectNone()
        }),
      ),
    ),
)
