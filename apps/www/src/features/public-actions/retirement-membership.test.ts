import { Locator, Story, TestHost } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { expect, it } from 'vitest'

import { LoadMembership, SaveMembership } from './commands'
import {
  audioA,
  audioB,
  control,
  controlsContext,
  document,
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

it('a conflicted uncertain membership intent clears its retry key and revision, reloads exactly once, adopts revision nine and never automatically retries the write', async () => {
  const fresh = Promise.withResolvers<Response>()
  let writes = 0
  let reads = 0

  const adapter = membershipAdapter(
    async () => new Response(null, { status: ++writes === 1 ? 503 : 409 }),
    async () => (++reads === 1 ? atomicStateResponse(3) : fresh.promise),
  )

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, controlsContext)
      yield* TestHost.settle
      Locator.fire(control(root, 'player'), 'click')
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        busy: false,
        revision: 3,
        mutationId,
        status: 'inactive',
      })
      Locator.fire(control(root, audioA.id), 'click')
      yield* TestHost.settle
      expect(adapter.writes).toHaveLength(2)
      expect(adapter.writes[1]).toEqual(adapter.writes[0])
      expect(adapter.reads).toHaveLength(2)
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        busy: true,
        revision: null,
        mutationId: null,
        status: 'loading',
      })
      expect(control(root, 'player').attrs?.disabled).toBe('')
      yield* TestHost.settle
      expect(adapter.writes).toHaveLength(2)
      fresh.resolve(atomicStateResponse(9, true))
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        busy: false,
        revision: 9,
        mutationId: null,
        status: 'active',
      })
      expect(adapter.reads).toHaveLength(2)
      expect(adapter.writes).toHaveLength(2)
      expect(control(root, 'player').attrs?.['aria-pressed']).toBe('true')
    }),
    Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
  )
})

it.each(['load', 'save'])(
  'wrong-account success and unauthorized failure cannot settle the current %s even with matching target, request and generation',
  (phase) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(RetirementMembershipState, listener)
          s.send(M.RequestedMembership({ target: audioA })).expectExact(LoadMembership)

          if (phase === 'save') {
            s.resolve(
              LoadMembership,
              M.SucceededLoadMembership({
                target: audioA,
                principalId: listener.principalId,
                generation: 0,
                request: 1,
                active: false,
                revision: 17,
              }),
            )
              .send(M.RequestedToggleMembership({ target: audioA }))
              .expectExact(SaveMembership)
          }

          const request = phase === 'save' ? 2 : 1
          const pending = s.model
          const wrong = { target: audioA, principalId: 'account-b', generation: 0, request }

          if (phase === 'save') {
            s.keepPending(SaveMembership)
              .send(M.SucceededSaveMembership({ ...wrong, active: true, revision: 18 }))
              .expectExact(SaveMembership)
              .keepPending(SaveMembership)
              .send(
                M.FailedSaveMembership({
                  ...wrong,
                  unauthorized: true,
                  conflicted: false,
                  mutationId,
                }),
              )
              .expectExact(SaveMembership)
            expect(s.model).toBe(pending)
            s.resolve(
              SaveMembership,
              M.SucceededSaveMembership({
                ...wrong,
                principalId: listener.principalId,
                active: true,
                revision: 18,
              }),
            )
          } else {
            s.keepPending(LoadMembership)
              .send(M.SucceededLoadMembership({ ...wrong, active: true, revision: 17 }))
              .expectExact(LoadMembership)
              .keepPending(LoadMembership)
              .send(M.FailedLoadMembership({ ...wrong, unauthorized: true }))
              .expectExact(LoadMembership)
            expect(s.model).toBe(pending)
            s.resolve(
              LoadMembership,
              M.SucceededLoadMembership({
                ...wrong,
                principalId: listener.principalId,
                active: false,
                revision: 17,
              }),
            )
          }

          s.expectNone()
        }),
      ),
    ),
)

it('a native atomic observation rejects wrong targets and request IDs and cannot toggle before observation or during its write', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Story.make(RetirementMembershipState, listener)
        const initial = s.model
        s.send(M.RequestedToggleMembership({ target: audioA })).expectNone()
        expect(s.model).toBe(initial)
        s.send(M.RequestedMembership({ target: audioA }))
          .expectExact(LoadMembership)
          .keepPending(LoadMembership)

        for (const correlation of [
          { target: audioB, principalId: listener.principalId, generation: 0, request: 1 },
          { target: audioA, principalId: listener.principalId, generation: 0, request: 0 },
          { target: audioA, principalId: 'account-b', generation: 0, request: 1 },
        ]) {
          const pending = s.model
          s.send(M.SucceededLoadMembership({ ...correlation, revision: 12, active: true }))
            .expectExact(LoadMembership)
            .keepPending(LoadMembership)
          expect(s.model).toBe(pending)
        }

        s.send(M.RequestedToggleMembership({ target: audioA }))
          .expectExact(LoadMembership)
          .resolve(
            LoadMembership,
            M.SucceededLoadMembership({
              target: audioA,
              principalId: listener.principalId,
              generation: 0,
              request: 1,
              revision: 12,
              active: true,
            }),
          )
        expect(s.model.entries['audio:audio-a']).toMatchObject({
          busy: false,
          revision: 12,
          status: 'active',
        })
        s.send(M.RequestedToggleMembership({ target: audioA }))
          .expectExact(SaveMembership)
          .keepPending(SaveMembership)
        const writing = s.model
        s.send(M.RequestedToggleMembership({ target: audioA })).expectExact(SaveMembership)
        expect(s.model).toBe(writing)
        s.keepPending(SaveMembership)
          .send(
            M.SucceededLoadMembership({
              target: audioA,
              principalId: listener.principalId,
              generation: 0,
              request: 2,
              revision: 92,
              active: true,
            }),
          )
          .expectExact(SaveMembership)
        expect(s.model).toBe(writing)
        s.resolve(
          SaveMembership,
          M.SucceededSaveMembership({
            target: audioA,
            principalId: listener.principalId,
            generation: 0,
            request: 2,
            revision: 13,
            active: false,
          }),
        ).expectNone()
        expect(s.model.entries['audio:audio-a']).toMatchObject({
          busy: false,
          revision: 13,
          mutationId: null,
          status: 'inactive',
        })
      }),
    ),
  ))

it('old same-account save successes and failures cannot settle a newer same-target retry, another audio, or an already settled acknowledgement', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* Story.make(RetirementMembershipState, listener)

        const correlation = {
          target: audioA,
          principalId: listener.principalId,
          generation: 0,
          request: 1,
        }

        s.send(M.RequestedMembership({ target: audioA }))
          .resolve(
            LoadMembership,
            M.SucceededLoadMembership({
              ...correlation,
              revision: 17,
              active: false,
            }),
          )
          .send(M.RequestedToggleMembership({ target: audioA }))
          .resolve(
            SaveMembership,
            M.FailedSaveMembership({
              ...correlation,
              request: 2,
              unauthorized: false,
              conflicted: false,
              mutationId,
            }),
          )
          .send(M.RequestedToggleMembership({ target: audioA }))
          .expectExact(SaveMembership)
          .keepPending(SaveMembership)
        s.props({
          ...listener,
          lifecycle: { navigationId: 1, pending: true },
        })
          .send(M.ChangedMembershipLifecycle())
          .expectExact(SaveMembership)
          .keepPending(SaveMembership)
        s.props({
          ...listener,
          lifecycle: { navigationId: 1, pending: false },
        })
          .send(M.ChangedMembershipLifecycle())
          .expectExact(SaveMembership)
          .keepPending(SaveMembership)
        const current = s.model

        for (const message of [
          M.SucceededSaveMembership({ ...correlation, request: 2, active: true, revision: 18 }),
          M.FailedSaveMembership({
            ...correlation,
            request: 2,
            unauthorized: true,
            conflicted: false,
            mutationId,
          }),
          M.SucceededSaveMembership({
            ...correlation,
            target: audioB,
            request: 3,
            active: true,
            revision: 18,
          }),
        ]) {
          s.send(message).expectExact(SaveMembership).keepPending(SaveMembership)
          expect(s.model).toBe(current)
        }

        s.resolve(
          SaveMembership,
          M.SucceededSaveMembership({
            ...correlation,
            request: 3,
            active: true,
            revision: 18,
          }),
        ).expectNone()
        const acknowledged = s.model
        s.send(
          M.SucceededSaveMembership({
            ...correlation,
            request: 3,
            active: false,
            revision: 19,
          }),
        )
          .send(
            M.FailedSaveMembership({
              ...correlation,
              request: 3,
              unauthorized: true,
              conflicted: false,
              mutationId,
            }),
          )
          .send(
            M.SucceededLoadMembership({
              ...correlation,
              active: false,
              revision: 17,
            }),
          )
          .expectNone()
        expect(s.model).toBe(acknowledged)
      }),
    ),
  ))

it.each(['load', 'save'])(
  'a current membership %s authorization refusal shows sign-in without inventing active membership',
  async (phase) => {
    const adapter = membershipAdapter(
      async () => new Response(null, { status: 401 }),
      phase === 'load' ? async () => new Response(null, { status: 401 }) : undefined,
    )

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, controlsContext)
        yield* TestHost.settle

        if (phase === 'save') {
          Locator.fire(control(root, 'player'), 'click')
          yield* TestHost.settle
        }

        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'anonymous',
          busy: false,
          revision: null,
          mutationId: null,
        })
        expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(2)
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
        expect(adapter.writes).toHaveLength(phase === 'save' ? 1 : 0)
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)

it('a failed removal preserves active acknowledged state and the page control retries the identical player intent', async () => {
  let calls = 0

  const adapter = membershipAdapter(
    async (body) => {
      calls++

      if (calls === 1) return new Response(null, { status: 503 })

      return receipt(body.requestId, audioA.id, false, 18)
    },
    async () => atomicStateResponse(17, true),
  )

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, controlsContext)
      yield* TestHost.settle
      Locator.fire(control(root, 'player'), 'click')
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'active',
        busy: false,
        revision: 17,
        mutationId,
      })
      expect(playerNotice(root)).toBe('Favorite could not be saved. Try again.')
      expect(control(root, audioA.id).attrs?.['aria-pressed']).toBe('true')
      Locator.fire(control(root, audioA.id), 'click')
      yield* TestHost.settle
      expect(adapter.writes[1]).toEqual(adapter.writes[0])
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'inactive',
        revision: 18,
        mutationId: null,
      })
      expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
    }),
    Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
  )
})

it('page acknowledgement and player acknowledgement carry the real revision in both directions', async () => {
  let writes = 0

  const adapter = membershipAdapter(async (body) =>
    receipt(body.requestId, audioA.id, ++writes === 1, 17 + writes),
  )

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, controlsContext)
      yield* TestHost.settle
      Locator.fire(control(root, audioA.id), 'click')
      yield* TestHost.settle
      expect(control(root, 'player').attrs?.['aria-pressed']).toBe('true')
      Locator.fire(control(root, 'player'), 'click')
      yield* TestHost.settle
      expect(adapter.writes.map(({ expectedRevision }) => expectedRevision)).toEqual([17, 18])
      expect(control(root, audioA.id).attrs?.['aria-pressed']).toBe('false')
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        revision: 19,
        status: 'inactive',
        busy: false,
      })
    }),
    Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
  )
})

it.each([false, true])(
  'a pending page write survives same-audio replacement, changed content %s, and a later fresh observation may replace it',
  async (changedContent) => {
    const held = Promise.withResolvers<Response>()
    let reads = 0

    const adapter = membershipAdapter(
      async () => held.promise,
      async () => atomicStateResponse(++reads === 1 ? 17 : 19),
    )

    const initial = { ...controlsContext, lifecycle: { navigationId: 0, pending: false } }
    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, initial)
        yield* TestHost.settle
        Locator.fire(control(root, audioA.id), 'click')
        yield* TestHost.settle
        const owned = membershipState(root)

        const targets = [
          changedContent ? { ...document(), path: '/mixes/audio-a?updated=1' } : document(),
        ]

        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...initial, targets, lifecycle: { navigationId: 1, pending: true } },
          }),
        )
        yield* TestHost.settle
        expect(membershipState(root)).toEqual(owned)
        held.resolve(receipt())
        yield* TestHost.settle
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...initial, targets, lifecycle: { navigationId: 1, pending: false } },
          }),
        )
        yield* TestHost.settle
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'active',
          revision: 18,
          busy: false,
        })
        expect(adapter.reads).toHaveLength(1)
        expect(adapter.writes).toHaveLength(1)
        expect(control(root, audioA.id).attrs?.['aria-pressed']).toBe('true')
        expect(control(root, 'player').attrs?.['aria-pressed']).toBe('true')
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...initial, lifecycle: { navigationId: 2, pending: true } },
          }),
        )
        yield* TestHost.settle
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...initial, lifecycle: { navigationId: 2, pending: false } },
          }),
        )
        yield* TestHost.settle
        expect(adapter.reads).toHaveLength(2)
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'inactive',
          revision: 19,
        })
        expect(control(root, audioA.id).attrs?.['aria-pressed']).toBe('false')
        expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)
