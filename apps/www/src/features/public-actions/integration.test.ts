import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Predicate } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, it } from 'vitest'

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

it('actual native page and player controls share one atomic observation, one busy lock and the acknowledged revision', async () => {
  const save = Promise.withResolvers<Response>()
  const adapter = membershipAdapter(() => save.promise)
  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, controlsContext)
      yield* TestHost.settle
      expect(adapter.reads).toEqual(['/api/favorites/audio/audio-a/state'])
      Locator.fire(control(root, 'player'), 'click')
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'inactive',
        busy: true,
        revision: 17,
      })
      expect(control(root, audioA.id).attrs?.['aria-pressed']).toBe('false')
      expect(control(root, audioA.id).attrs?.disabled).toBe('')
      Locator.fire(control(root, audioA.id), 'click')
      yield* TestHost.settle
      expect(adapter.writes).toHaveLength(1)
      save.resolve(receipt())
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'active',
        busy: false,
        revision: 18,
        mutationId: null,
      })
      expect(control(root, audioA.id).attrs?.['aria-pressed']).toBe('true')
      expect(control(root, 'player').attrs?.['aria-pressed']).toBe('true')
      expect(
        root
          .log()
          .filter(
            (entry) =>
              Predicate.isTagged(entry, 'Mounted') && entry.path.endsWith('/MembershipProvider[]'),
          ),
      ).toHaveLength(1)
    }),
    Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
  )
})

it.each(['saved', 'unauthorized', 'lost'] satisfies ReadonlyArray<string>)(
  'an old-account %s receipt cannot settle a new account or a later generation of the original account',
  async (result) => {
    const save = Promise.withResolvers<Response>()
    const adapter = membershipAdapter(() => save.promise)
    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, controlsContext)
        yield* TestHost.settle
        Locator.fire(control(root, audioA.id), 'click')
        yield* TestHost.settle
        const first = membershipState(root)
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...controlsContext, principalId: 'account-b' },
          }),
        )
        yield* TestHost.settle
        expect(membershipState(root)).toMatchObject({
          principalId: 'account-b',
          entries: {
            'audio:audio-a': { status: 'inactive', busy: false, revision: 17 },
          },
        })
        root.send(IntegrationContextMessage.ChangedContext({ context: controlsContext }))
        yield* TestHost.settle
        const returned = membershipState(root)
        expect(returned.generation).toBeGreaterThan(first.generation)

        if (result === 'saved') save.resolve(receipt())
        else save.resolve(new Response('', { status: result === 'unauthorized' ? 401 : 503 }))
        yield* TestHost.settle
        expect(membershipState(root)).toEqual(returned)
        expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
        expect(root.text()).not.toContain('Sign in to continue.')
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)

it('an acknowledged audio A write cannot replace a different visible audio B membership', async () => {
  const save = Promise.withResolvers<Response>()
  const adapter = membershipAdapter(() => save.promise)
  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, controlsContext)
      yield* TestHost.settle
      Locator.fire(control(root, audioA.id), 'click')
      yield* TestHost.settle
      root.send(
        IntegrationContextMessage.ChangedContext({
          context: { ...listener, targets: [document(audioB)] },
        }),
      )
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']?.busy).toBe(true)
      expect(control(root, audioB.id).attrs?.['aria-pressed']).toBe('false')
      save.resolve(receipt())
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'active',
        revision: 18,
      })
      expect(membershipState(root).entries['audio:audio-b']).toMatchObject({
        status: 'inactive',
        revision: 18,
      })
      expect(control(root, audioB.id).attrs?.['aria-pressed']).toBe('false')
      expect(control(root, 'player').attrs?.['aria-pressed']).toBe('true')
    }),
    Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
  )
})

it.each([
  { name: 'another audio', changed: { targetId: audioB.id } },
  { name: 'another kind with the same ID', changed: { targetKind: 'show' } },
  { name: 'another mutation', changed: { requestId: '00000000-0000-4000-8000-000000000002' } },
  { name: 'the wrong intent', changed: { desiredState: false } },
  { name: 'a non-successor revision', changed: { revision: 19 } },
])(
  'a receipt for $name cannot acknowledge this write or alter another consumer',
  async ({ changed }) => {
    const adapter = membershipAdapter(async () =>
      Response.json({
        requestId: mutationId,
        operationId: 'a'.repeat(64),
        targetKind: 'audio',
        targetId: audioA.id,
        desiredState: true,
        revision: 18,
        notifications: 'not_sent',
        ...changed,
      }),
    )

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, {
          ...controlsContext,
          targets: [document(), document(audioB)],
        })

        yield* TestHost.settle
        Locator.fire(control(root, audioA.id), 'click')
        yield* TestHost.settle
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'inactive',
          busy: false,
          revision: 17,
          mutationId,
        })
        expect(membershipState(root).entries['audio:audio-b']).toMatchObject({
          status: 'inactive',
          busy: false,
          revision: 17,
          mutationId: null,
          notice: null,
        })
        expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
        expect(root.text()).not.toContain('Saved')
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)

it('an uncertain write survives same-account document replacement and retries the exact HTTP intent from the other control', async () => {
  let attempts = 0

  const adapter = membershipAdapter(async () => {
    attempts += 1

    return attempts === 1 ? new Response('', { status: 503 }) : receipt()
  })

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, controlsContext)
      yield* TestHost.settle
      Locator.fire(control(root, audioA.id), 'click')
      yield* TestHost.settle
      const uncertain = membershipState(root).entries['audio:audio-a']
      expect(uncertain).toMatchObject({ status: 'inactive', revision: 17, mutationId, request: 2 })
      root.send(
        IntegrationContextMessage.ChangedContext({
          context: {
            ...controlsContext,
            targets: [{ ...document(audioA, 'active'), path: '/mixes/audio-a?fresh=1' }],
          },
        }),
      )
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toEqual(uncertain)
      Locator.fire(control(root, 'player'), 'click')
      yield* TestHost.settle
      expect(adapter.writes).toEqual([
        { requestId: mutationId, expectedRevision: 17, audioId: audioA.id },
        { requestId: mutationId, expectedRevision: 17, audioId: audioA.id },
      ])
      expect(adapter.reads).toHaveLength(1)
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'active',
        revision: 18,
        mutationId: null,
        request: 3,
      })
    }),
    Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
  )
})

it('a stale notice timer from the first failed request cannot hide the later acknowledgement notice', async () => {
  let attempts = 0

  const adapter = membershipAdapter(async () => {
    attempts += 1

    return attempts === 1 ? new Response('', { status: 503 }) : receipt()
  })

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, controlsContext)

      const notice = () =>
        Locator.attr('role', 'status')
          .all(root.get(Locator.attr('data-target', 'player')))
          .map(Locator.textOf)
          .join(' ')

      yield* TestHost.settle
      Locator.fire(control(root, 'player'), 'click')
      yield* TestHost.settle
      expect(notice()).toBe('Favorite could not be saved. Try again.')
      yield* TestClock.adjust('2 seconds')
      Locator.fire(control(root, 'player'), 'click')
      yield* TestHost.settle
      expect(notice()).toContain('Saved')
      yield* TestClock.adjust('2 seconds')
      yield* TestHost.settle
      expect(notice()).toContain('Saved')
      yield* TestClock.adjust('2 seconds')
      yield* TestHost.settle
      expect(notice()).not.toContain('Saved')
    }),
    Layer.mergeAll(TestHost.layer(), TestClock.layer(), playerLayer, adapter.layer),
  )
})

it.each([false, true])(
  'a late prior-account atomic read cannot replace the current owner, unauthorized: %s',
  async (unauthorized) => {
    const oldRead = Promise.withResolvers<Response>()
    let reads = 0

    const adapter = membershipAdapter(
      async () => receipt(),
      async () => {
        reads += 1

        return reads === 1
          ? oldRead.promise
          : Response.json({ revision: 27, favorited: false, subscribed: false })
      },
    )

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, controlsContext)
        yield* TestHost.settle
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          busy: true,
          revision: null,
        })
        expect(control(root, audioA.id).attrs?.disabled).toBe('')
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...controlsContext, principalId: 'account-b' },
          }),
        )
        yield* TestHost.settle
        const current = membershipState(root)
        expect(current).toMatchObject({
          principalId: 'account-b',
          entries: {
            'audio:audio-a': { status: 'inactive', revision: 27, busy: false },
          },
        })
        oldRead.resolve(
          unauthorized
            ? new Response('', { status: 401 })
            : Response.json({
                revision: 18,
                favorited: true,
                subscribed: false,
              }),
        )
        yield* TestHost.settle
        expect(membershipState(root)).toEqual(current)
        expect(control(root, 'player').attrs?.['aria-pressed']).toBe('false')
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)

it.each([false, true])(
  'an old write cannot settle the same audio while a different account write is pending, unauthorized: %s',
  async (unauthorized) => {
    const oldSave = Promise.withResolvers<Response>()
    const currentSave = Promise.withResolvers<Response>()
    let attempts = 0

    const adapter = membershipAdapter(async () => {
      attempts += 1

      return attempts === 1 ? oldSave.promise : currentSave.promise
    })

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(MembershipControls, controlsContext)
        yield* TestHost.settle
        Locator.fire(control(root, audioA.id), 'click')
        yield* TestHost.settle
        root.send(
          IntegrationContextMessage.ChangedContext({
            context: { ...controlsContext, principalId: 'account-b' },
          }),
        )
        yield* TestHost.settle
        Locator.fire(control(root, 'player'), 'click')
        yield* TestHost.settle
        const current = membershipState(root)
        expect(current).toMatchObject({
          principalId: 'account-b',
          entries: {
            'audio:audio-a': { busy: true, revision: 17, status: 'inactive' },
          },
        })
        oldSave.resolve(unauthorized ? new Response('', { status: 401 }) : receipt())
        yield* TestHost.settle
        expect(membershipState(root)).toEqual(current)
        currentSave.resolve(receipt('00000000-0000-4000-8000-000000000002'))
        yield* TestHost.settle
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'active',
          revision: 18,
          busy: false,
        })
        expect(adapter.writes.map(({ requestId }) => requestId)).toEqual([
          mutationId,
          '00000000-0000-4000-8000-000000000002',
        ])
      }),
      Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
    )
  },
)

it('audio and show targets with the same ID remain separate while sharing the actual listener revision', async () => {
  const adapter = membershipAdapter(async (body) => {
    if (body.audioId) return receipt()

    return Response.json({
      requestId: '00000000-0000-4000-8000-000000000002',
      operationId: 'b'.repeat(64),
      targetKind: 'show',
      targetId: audioA.id,
      desiredState: true,
      revision: 19,
      notifications: 'not_sent',
    })
  })

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(MembershipControls, {
        ...controlsContext,
        targets: [document(), document({ kind: 'show', id: audioA.id })],
      })

      yield* TestHost.settle
      Locator.fire(control(root, audioA.id), 'click')
      yield* TestHost.settle
      expect(membershipState(root).entries['show:audio-a']).toMatchObject({
        status: 'inactive',
        revision: 18,
        notice: null,
      })
      expect(control(root, audioA.id, 'show').attrs?.['aria-pressed']).toBe('false')
      Locator.fire(control(root, audioA.id, 'show'), 'click')
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'active',
        revision: 19,
      })
      expect(membershipState(root).entries['show:audio-a']).toMatchObject({
        status: 'active',
        revision: 19,
      })
      expect(adapter.writes[1]).toEqual({
        requestId: '00000000-0000-4000-8000-000000000002',
        expectedRevision: 18,
      })
    }),
    Layer.mergeAll(TestHost.layer(), playerLayer, adapter.layer),
  )
})
