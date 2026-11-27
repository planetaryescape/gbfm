import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Predicate, PubSub } from 'effect'
import { expect, it } from 'vitest'

import type { PlayerSnapshot } from '../features/player/domain'
import {
  audioA,
  audioB,
  bootstrap,
  document,
  listener,
  membershipAdapter,
  membershipState,
  mutationId,
  page,
  receipt,
  rootLayer,
  runWithLayer,
} from '../features/public-actions/integration.test-support'
import {
  atomicStateResponse,
  clickRetirementFavorite,
  movingPlayerLayer,
  openRetirementPlayer,
  queuedSnapshot,
  retirementPlayerIdentity,
} from '../features/public-actions/retirement.test-support'
import { GetPage } from './page-query'
import { RoutedApplicationMessage, RoutedApplicationNoDeps } from './routed-application'

it('actual Root requires an atomic owner-bound observation on init and return from a no-action page', async () => {
  const first = Promise.withResolvers<Response>()
  let reads = 0

  const adapter = membershipAdapter(
    async (body) => receipt(body.requestId, audioA.id, false, 72),
    async () => (++reads === 1 ? first.promise : atomicStateResponse(73)),
  )

  await runWithLayer(
    Effect.gen(function* () {
      const router = yield* Router.Router
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
      yield* TestHost.settle
      yield* openRetirementPlayer(root)
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        busy: true,
        status: 'loading',
        revision: null,
      })
      expect(adapter.reads).toEqual(['/api/favorites/audio/audio-a/state'])
      expect(adapter.writes).toEqual([])
      const checking = root.all(Locator.attr('aria-label', 'Add to favorites'))
      expect(checking).toHaveLength(1)
      expect(
        checking.every((node) => Predicate.isTagged(node, 'Element') && node.attrs.disabled === ''),
      ).toBe(true)
      first.resolve(atomicStateResponse(71, true))
      yield* TestHost.settle
      expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(2)
      clickRetirementFavorite(root, true, 'page')
      yield* TestHost.settle
      expect(adapter.writes[0]).toMatchObject({ expectedRevision: 71 })
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'inactive',
        revision: 72,
        busy: false,
      })
      yield* router.navigate('/about')
      yield* TestHost.settle
      expect(root.all(Locator.attr('aria-label', 'Add to favorites'))).toHaveLength(1)
      const beforeReturn = adapter.reads.length
      yield* router.navigate('/mixes/audio-a?return=1')
      yield* TestHost.settle
      expect(adapter.reads).toHaveLength(beforeReturn + 1)
      expect(root.all(Locator.attr('aria-label', 'Add to favorites'))).toHaveLength(2)
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'inactive',
        revision: 73,
        busy: false,
      })
    }),
    rootLayer(async (input) => {
      const url = new URL(new Request(input).url)
      url.searchParams.delete('__data')

      return Response.json(page(`${url.pathname}${url.search}`))
    }, adapter.layer),
  )
})

it.each([true, false])(
  'actual Root known-null %s does not invent membership or issue an anonymous write',
  async (known) => {
    let pageReads = 0
    const adapter = membershipAdapter(async () => receipt())
    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, {
          ...bootstrap(),
          identity: { principalId: null, known, epoch: 0 },
        })

        yield* TestHost.settle
        yield* openRetirementPlayer(root)
        expect(pageReads).toBeGreaterThan(0)
        expect(adapter.reads).toEqual([])
        expect(adapter.writes).toEqual([])
        expect(membershipState(root)).toMatchObject({
          principalId: null,
          principalKnown: known,
          entries: {
            'audio:audio-a': {
              status: known ? 'anonymous' : 'unavailable',
              busy: false,
              revision: null,
            },
          },
        })
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
        expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(
          known ? 2 : 0,
        )
        expect(root.all(Locator.attr('aria-label', 'Retry loading favorite'))).toHaveLength(
          known ? 0 : 1,
        )
      }),
      rootLayer(async () => {
        pageReads++

        return Response.json(page('/mixes/audio-a', null, audioA, known))
      }, adapter.layer),
    )
  },
)

it('a failed Root membership observation preserves independently verified A, but a confirmed sign-out rejects its late retry result', async () => {
  const first = Promise.withResolvers<Response>()
  const retry = Promise.withResolvers<Response>()
  let pages = 0
  let reads = 0

  const adapter = membershipAdapter(
    async () => receipt(),
    async () => (++reads === 1 ? first.promise : retry.promise),
  )

  await runWithLayer(
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
      yield* TestHost.settle
      yield* openRetirementPlayer(root)
      first.resolve(new Response(null, { status: 503 }))
      yield* TestHost.settle
      expect(retirementPlayerIdentity(root)).toEqual(listener)
      expect(membershipState(root)).toMatchObject({
        ...listener,
        entries: { 'audio:audio-a': { status: 'unavailable', revision: null, busy: false } },
      })
      expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(0)
      Locator.fire(root.get(Locator.attr('aria-label', 'Retry loading favorite')), 'click')
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']?.busy).toBe(true)
      expect(retirementPlayerIdentity(root)).toEqual(listener)
      root.send(RoutedApplicationMessage.ChangedAuthentication())
      yield* TestHost.settle
      const signedOut = membershipState(root)
      expect(retirementPlayerIdentity(root)).toEqual({
        principalId: null,
        principalKnown: true,
      })
      retry.resolve(atomicStateResponse(18, true))
      yield* TestHost.settle
      expect(membershipState(root)).toEqual(signedOut)
      expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(2)
      expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
    }),
    rootLayer(
      async () =>
        Response.json(page('/mixes/audio-a', ++pages === 1 ? listener.principalId : null)),
      adapter.layer,
    ),
  )
})

it('an ordinary Root page with unknown identity suspends the old favorite until a fresh verified observation restores it', async () => {
  const adapter = membershipAdapter(
    async () => receipt(),
    async () => atomicStateResponse(18, true),
  )

  await runWithLayer(
    Effect.gen(function* () {
      const router = yield* Router.Router
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
      yield* TestHost.settle
      yield* openRetirementPlayer(root)
      expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(2)
      yield* router.navigate('/about?unknown=1')
      yield* TestHost.settle
      expect(retirementPlayerIdentity(root)).toEqual({
        principalId: null,
        principalKnown: false,
      })
      expect(membershipState(root)).toMatchObject({ principalId: null, principalKnown: false })
      expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
      expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(0)
      yield* router.navigate('/mixes/audio-a?verified=1')
      yield* TestHost.settle
      expect(retirementPlayerIdentity(root)).toEqual(listener)
      expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(2)
    }),
    rootLayer(async (input) => {
      const url = new URL(new Request(input).url)
      url.searchParams.delete('__data')

      return Response.json(
        page(
          `${url.pathname}${url.search}`,
          url.searchParams.has('unknown') ? null : listener.principalId,
          audioA,
          !url.searchParams.has('unknown'),
        ),
      )
    }, adapter.layer),
  )
})

it('actual Root loads the queued audio on an unrelated page, retains its same-account heart and reobserves after account switch and sign-out', async () => {
  const first = Promise.withResolvers<Response>()
  const nextAccount = Promise.withResolvers<Response>()
  let principalId: string | null = listener.principalId
  let reads = 0

  const adapter = membershipAdapter(
    async () => receipt(),
    async () => {
      reads++

      if (reads === 1) return first.promise

      if (principalId === 'account-b') return nextAccount.promise

      return atomicStateResponse(17, true)
    },
  )

  await runWithLayer(
    Effect.gen(function* () {
      const router = yield* Router.Router
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
      yield* TestHost.settle
      yield* openRetirementPlayer(root)
      expect(root.text()).toContain('/about')
      expect(adapter.reads).toEqual(['/api/favorites/audio/audio-a/state'])
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        busy: true,
        status: 'loading',
        revision: null,
      })
      first.resolve(atomicStateResponse(17, true))
      yield* TestHost.settle
      expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(1)
      yield* router.navigate('/shows')
      yield* TestHost.settle
      expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(1)
      expect(retirementPlayerIdentity(root)).toEqual(listener)
      principalId = 'account-b'
      root.send(RoutedApplicationMessage.ChangedAuthentication())
      yield* TestHost.settle
      expect(retirementPlayerIdentity(root)).toEqual({
        principalId: 'account-b',
        principalKnown: true,
      })
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        busy: true,
        status: 'loading',
        revision: null,
      })
      expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
      nextAccount.resolve(atomicStateResponse(23))
      yield* TestHost.settle
      expect(root.all(Locator.attr('aria-label', 'Add to favorites'))).toHaveLength(1)
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'inactive',
        revision: 23,
        busy: false,
      })
      principalId = null
      root.send(RoutedApplicationMessage.ChangedAuthentication())
      yield* TestHost.settle
      expect(retirementPlayerIdentity(root)).toEqual({
        principalId: null,
        principalKnown: true,
      })
      expect(root.all(Locator.attr('aria-label', 'Sign in to favorite'))).toHaveLength(1)
      expect(adapter.writes).toEqual([])
    }),
    rootLayer(async (input) => {
      const url = new URL(new Request(input).url)

      return Response.json(page(url.pathname === '/shows' ? '/shows' : '/about', principalId))
    }, adapter.layer),
  )
})

it.each(['previous account', 'signed-out'])(
  'a superseded Root %s page cannot replace a verified B acknowledgement, and a later fresh B observation can remove it',
  async (oldIdentity) => {
    const old = Promise.withResolvers<void>()
    const recovered = Promise.withResolvers<void>()
    let pages = 0
    let reads = 0

    const adapter = membershipAdapter(
      async (body) => receipt(body.requestId, audioA.id, true, 104),
      async () => atomicStateResponse(++reads === 1 ? 103 : 105),
    )

    await runWithLayer(
      Effect.gen(function* () {
        const router = yield* Router.Router

        const root = yield* TestHost.mount(RoutedApplicationNoDeps, {
          ...bootstrap(),
          identity: { principalId: null, known: false, epoch: 0 },
        })

        yield* TestHost.settle
        yield* openRetirementPlayer(root)
        expect(adapter.reads).toEqual([])
        Locator.fire(root.get(Locator.attr('aria-label', 'Retry loading favorite')), 'click')
        yield* TestHost.settle
        expect(adapter.reads).toEqual([])
        root.send(RoutedApplicationMessage.ChangedAuthentication())
        yield* TestHost.settle
        recovered.resolve()
        yield* TestHost.settle
        expect(retirementPlayerIdentity(root)).toEqual({
          principalId: 'verified-b',
          principalKnown: true,
        })
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'inactive',
          revision: 103,
        })
        clickRetirementFavorite(root)
        yield* TestHost.settle
        expect(adapter.writes[0]).toMatchObject({ expectedRevision: 103 })
        old.resolve()
        yield* TestHost.settle
        expect(membershipState(root)).toMatchObject({
          principalId: 'verified-b',
          entries: { 'audio:audio-a': { status: 'active', revision: 104, busy: false } },
        })
        expect(retirementPlayerIdentity(root)).toEqual({
          principalId: 'verified-b',
          principalKnown: true,
        })
        yield* router.navigate('/mixes/audio-a?fresh=1')
        yield* TestHost.settle
        expect(membershipState(root)).toMatchObject({
          principalId: 'verified-b',
          entries: { 'audio:audio-a': { status: 'inactive', revision: 105, busy: false } },
        })
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
      }),
      rootLayer(async (input) => {
        const url = new URL(new Request(input).url)

        if (url.searchParams.has('fresh'))
          return Response.json(page('/mixes/audio-a?fresh=1', 'verified-b'))
        pages++

        if (pages === 1) return Response.json(page('/mixes/audio-a', null, audioA, false))

        if (pages === 2) {
          await old.promise

          return Response.json(
            page(
              '/mixes/audio-a',
              oldIdentity === 'previous account' ? listener.principalId : null,
            ),
          )
        }

        await recovered.promise

        return Response.json(page('/mixes/audio-a', 'verified-b'))
      }, adapter.layer),
    )
  },
)

it('a current page membership 401 invalidates Player identity and an older queued read cannot restore it', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* PubSub.unbounded<PlayerSnapshot>()
        const old = Promise.withResolvers<Response>()
        const refresh = Promise.withResolvers<Response>()
        let pageReads = 0

        const adapter = membershipAdapter(
          async () => new Response(null, { status: 401 }),
          async (url) => (url.includes(audioB.id) ? old.promise : atomicStateResponse(17)),
        )

        yield* Effect.promise(() =>
          runWithLayer(
            Effect.gen(function* () {
              const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
              yield* TestHost.settle
              yield* openRetirementPlayer(root)
              const owner = membershipState(root)
              const entry = owner.entries['audio:audio-a']

              if (!entry) throw new Error('Missing observed audio A before its current write')
              yield* PubSub.publish(source, queuedSnapshot(audioB.id))
              yield* TestHost.settle
              expect(membershipState(root).entries['audio:audio-b']).toMatchObject({
                status: 'loading',
                busy: true,
              })
              clickRetirementFavorite(root, false, 'page')
              yield* TestHost.settle
              expect(adapter.writes).toEqual([
                { requestId: mutationId, expectedRevision: 17, audioId: audioA.id },
              ])

              const failure = root
                .log()
                .findLast(
                  (event) =>
                    Predicate.isTagged(event, 'Update') &&
                    event.path.endsWith('/MembershipProvider[]') &&
                    Predicate.isTagged(event.message, 'FailedSaveMembership'),
                )

              expect(failure).toMatchObject({
                message: {
                  target: audioA,
                  principalId: listener.principalId,
                  generation: owner.generation,
                  request: entry.request + 1,
                  mutationId,
                  unauthorized: true,
                  conflicted: false,
                },
              })
              const suspended = membershipState(root)
              expect(suspended).toMatchObject({
                principalId: null,
                principalKnown: false,
                revision: null,
              })
              expect(
                Object.values(suspended.entries).every(
                  (value) =>
                    value.status !== 'active' &&
                    value.status !== 'anonymous' &&
                    value.revision === null,
                ),
              ).toBe(true)
              expect(retirementPlayerIdentity(root)).toEqual({
                principalId: null,
                principalKnown: false,
              })
              old.resolve(atomicStateResponse(18, true))
              yield* TestHost.settle
              expect(membershipState(root)).toEqual(suspended)
              expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
              expect(retirementPlayerIdentity(root).principalId).toBeNull()
              refresh.resolve(Response.json(page('/mixes/audio-a', null)))
              yield* TestHost.settle
              expect(retirementPlayerIdentity(root)).toEqual({
                principalId: null,
                principalKnown: true,
              })
            }),
            Layer.merge(
              rootLayer(
                async () =>
                  ++pageReads === 1 ? Response.json(page('/mixes/audio-a')) : refresh.promise,
                adapter.layer,
              ),
              movingPlayerLayer(source),
            ),
          ),
        )
      }),
    ),
  )
})

it.each([false, true])(
  'actual Root retains a pending page save through same-audio navigation with changed content %s and then accepts a later removal',
  async (changedContent) => {
    const held = Promise.withResolvers<Response>()
    const next = Promise.withResolvers<Response>()
    let reads = 0

    const adapter = membershipAdapter(
      async () => held.promise,
      async () => atomicStateResponse(++reads === 1 ? 17 : 19),
    )

    await runWithLayer(
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
        yield* TestHost.settle
        yield* openRetirementPlayer(root)
        clickRetirementFavorite(root, false, 'page')
        yield* TestHost.settle
        const pending = membershipState(root)
        yield* router.navigate('/mixes/audio-a?pending=1')
        yield* TestHost.settle
        expect(membershipState(root)).toEqual(pending)
        expect(retirementPlayerIdentity(root)).toEqual(listener)
        held.resolve(receipt())
        yield* TestHost.settle
        next.resolve(
          Response.json({
            ...page('/mixes/audio-a?pending=1'),
            description: changedContent ? 'Updated server content' : '',
          }),
        )
        yield* TestHost.settle
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'active',
          revision: 18,
          busy: false,
        })
        expect(adapter.reads).toHaveLength(1)
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(2)
        yield* router.navigate('/mixes/audio-a?fresh=1')
        yield* TestHost.settle
        expect(adapter.reads).toHaveLength(2)
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'inactive',
          revision: 19,
          busy: false,
        })
        expect(root.all(Locator.attr('aria-label', 'Add to favorites'))).toHaveLength(2)
      }),
      rootLayer(async (input) => {
        const url = new URL(new Request(input).url)

        if (url.searchParams.has('pending')) return next.promise
        url.searchParams.delete('__data')

        return Response.json(page(`${url.pathname}${url.search}`))
      }, adapter.layer),
    )
  },
)

it.each(
  ['load', 'save'].flatMap((phase) =>
    ['saved', 'unauthorized'].flatMap((result) =>
      ['unknown', 'signed-out', 'account-b'].map((recovery) => ({ phase, result, recovery })),
    ),
  ),
)(
  'ChangedAuthentication suspends Player and fences an old $phase $result before verified $recovery recovery',
  async ({ phase, result, recovery }) => {
    const old = Promise.withResolvers<Response>()
    const refreshed = Promise.withResolvers<void>()
    let pages = 0
    let reads = 0

    const adapter = membershipAdapter(
      async () => old.promise,
      async () => {
        if (++reads === 1) return phase === 'load' ? old.promise : atomicStateResponse(17)

        return atomicStateResponse(23)
      },
    )

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
        yield* TestHost.settle
        yield* openRetirementPlayer(root)

        if (phase === 'save') {
          clickRetirementFavorite(root)
          yield* TestHost.settle
        }

        root.send(RoutedApplicationMessage.ChangedAuthentication())
        yield* TestHost.settle
        expect(retirementPlayerIdentity(root)).toEqual({
          principalId: null,
          principalKnown: false,
        })
        const suspended = membershipState(root)
        expect(suspended).toMatchObject({ principalId: null, principalKnown: false })
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)

        if (result === 'unauthorized') old.resolve(new Response(null, { status: 401 }))
        else old.resolve(phase === 'load' ? atomicStateResponse(18, true) : receipt())
        yield* TestHost.settle
        expect(membershipState(root)).toEqual(suspended)
        expect(retirementPlayerIdentity(root)).toEqual({
          principalId: null,
          principalKnown: false,
        })
        refreshed.resolve()
        yield* TestHost.settle
        const known = recovery !== 'unknown'
        const principalId = recovery === 'account-b' ? 'account-b' : null
        const confirmedStatus = principalId ? 'inactive' : 'anonymous'
        expect(retirementPlayerIdentity(root)).toEqual({ principalId, principalKnown: known })
        expect(membershipState(root)).toMatchObject({
          principalId,
          principalKnown: known,
          entries: {
            'audio:audio-a': {
              status: known ? confirmedStatus : 'unavailable',
              revision: recovery === 'account-b' ? 23 : null,
              busy: false,
            },
          },
        })
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
        expect(adapter.writes).toHaveLength(phase === 'save' ? 1 : 0)
      }),
      rootLayer(async () => {
        if (++pages === 1) return Response.json(page('/mixes/audio-a'))
        await refreshed.promise

        return Response.json(
          page(
            '/mixes/audio-a',
            recovery === 'account-b' ? 'account-b' : null,
            audioA,
            recovery !== 'unknown',
          ),
        )
      }, adapter.layer),
    )
  },
)

it.each(['page', 'player'])(
  'actual Root keeps an uncertain %s intent through page observation and retries its identical mutation from the other control',
  async (consumer) => {
    const next = Promise.withResolvers<Response>()
    let writes = 0

    const adapter = membershipAdapter(async (body) => {
      if (++writes === 1) return new Response(null, { status: 503 })

      return receipt(body.requestId)
    })

    await runWithLayer(
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
        yield* TestHost.settle
        yield* openRetirementPlayer(root)
        clickRetirementFavorite(root, false, consumer === 'page' ? 'page' : 'player')
        yield* TestHost.settle
        const uncertain = membershipState(root).entries['audio:audio-a']
        expect(uncertain).toMatchObject({ status: 'inactive', revision: 17, busy: false })
        expect(uncertain?.mutationId).toBe(adapter.writes[0]?.requestId)
        yield* router.navigate('/mixes/audio-a?late=1')
        yield* TestHost.settle
        next.resolve(
          Response.json({
            ...page('/mixes/audio-a?late=1'),
            publicAction: document(audioA, 'active'),
          }),
        )
        yield* TestHost.settle
        expect(membershipState(root).entries['audio:audio-a']).toEqual(uncertain)
        expect(adapter.reads).toHaveLength(1)
        clickRetirementFavorite(root, false, consumer === 'page' ? 'player' : 'page')
        yield* TestHost.settle
        expect(adapter.writes).toHaveLength(2)
        expect(adapter.writes[1]).toEqual(adapter.writes[0])
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: 'active',
          revision: 18,
          mutationId: null,
          busy: false,
        })
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(2)
      }),
      rootLayer(
        async (input) =>
          new URL(new Request(input).url).searchParams.has('late')
            ? next.promise
            : Response.json(page('/mixes/audio-a')),
        adapter.layer,
      ),
    )
  },
)

it.each(
  ['load', 'save'].flatMap((phase) =>
    ['saved', 'unauthorized'].flatMap((result) =>
      ['account-b', 'signed-out'].map((recovery) => ({ phase, result, recovery })),
    ),
  ),
)(
  'verified Root $recovery rejects an old $phase $result after the new page identity has settled and during a later revisit',
  async ({ phase, result, recovery }) => {
    const old = Promise.withResolvers<Response>()
    let pages = 0
    let reads = 0

    const adapter = membershipAdapter(
      async () => old.promise,
      async () => {
        if (++reads === 1) return phase === 'load' ? old.promise : atomicStateResponse(17)

        return atomicStateResponse(27)
      },
    )

    await runWithLayer(
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
        yield* TestHost.settle
        yield* openRetirementPlayer(root)

        if (phase === 'save') {
          clickRetirementFavorite(root, false, 'page')
          yield* TestHost.settle
        }

        root.send(RoutedApplicationMessage.ChangedAuthentication())
        yield* TestHost.settle
        const principalId = recovery === 'account-b' ? 'account-b' : null
        const verified = membershipState(root)
        expect(verified).toMatchObject({
          principalId,
          principalKnown: true,
          entries: {
            'audio:audio-a': {
              status: principalId ? 'inactive' : 'anonymous',
              revision: principalId ? 27 : null,
              busy: false,
            },
          },
        })
        expect(retirementPlayerIdentity(root)).toEqual({ principalId, principalKnown: true })

        if (result === 'unauthorized') old.resolve(new Response(null, { status: 401 }))
        else old.resolve(phase === 'load' ? atomicStateResponse(18, true) : receipt())
        yield* TestHost.settle
        expect(membershipState(root)).toEqual(verified)
        expect(retirementPlayerIdentity(root)).toEqual({ principalId, principalKnown: true })
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
        yield* router.navigate('/mixes/audio-a?revisit=1')
        yield* TestHost.settle
        expect(retirementPlayerIdentity(root)).toEqual({ principalId, principalKnown: true })
        expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
          status: principalId ? 'inactive' : 'anonymous',
          busy: false,
        })
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
      }),
      rootLayer(async (input) => {
        pages++
        const principalId = recovery === 'account-b' ? 'account-b' : null
        const url = new URL(new Request(input).url)
        url.searchParams.delete('__data')

        return Response.json(
          page(`${url.pathname}${url.search}`, pages === 1 ? listener.principalId : principalId),
        )
      }, adapter.layer),
    )
  },
)

it.each(['before returning', 'after returning'])(
  'actual Root protects an acknowledged A write from a stale page read arriving %s across queued A to B to A and a later fresh removal',
  async (arrival) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* PubSub.unbounded<PlayerSnapshot>()
          const late = Promise.withResolvers<Response>()
          const loadB = Promise.withResolvers<void>()
          let revision = 17

          const adapter = membershipAdapter(
            async (body) => {
              revision = 18

              return receipt(body.requestId)
            },
            async (url) => {
              if (url.includes(audioB.id)) await loadB.promise

              return atomicStateResponse(revision, url.includes(audioA.id) && revision === 18)
            },
          )

          yield* Effect.promise(() =>
            runWithLayer(
              Effect.gen(function* () {
                const router = yield* Router.Router
                const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
                yield* TestHost.settle
                yield* openRetirementPlayer(root)
                yield* router.navigate('/mixes/audio-a?late=1')
                yield* TestHost.settle
                expect(retirementPlayerIdentity(root)).toEqual(listener)
                clickRetirementFavorite(root)
                yield* TestHost.settle
                expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
                  status: 'active',
                  revision: 18,
                  busy: false,
                })
                yield* PubSub.publish(source, queuedSnapshot(audioB.id))
                yield* TestHost.settle
                expect(membershipState(root).entries['audio:audio-b']).toMatchObject({
                  status: 'loading',
                  busy: true,
                  revision: null,
                })

                if (arrival === 'after returning') {
                  yield* PubSub.publish(source, queuedSnapshot(audioA.id))
                  yield* TestHost.settle
                }

                late.resolve(Response.json(page('/mixes/audio-a?late=1')))
                yield* TestHost.settle
                expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
                  status: 'active',
                  revision: 18,
                  busy: false,
                })
                expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(
                  arrival === 'after returning' ? 2 : 1,
                )

                if (arrival === 'before returning')
                  expect(root.all(Locator.attr('aria-label', 'Checking favorite'))).toHaveLength(1)
                const model = root.model()

                if (!model) throw new Error('Native Root stopped rendering')

                const cached = root.entry(GetPage, {
                  path: '/mixes/audio-a?late=1',
                  identity: model.identity,
                  realm: bootstrap().realm,
                })

                if (!cached || !Predicate.isTagged(cached.stored, 'Success'))
                  throw new Error('Missing actual stale GetPage response in query cache')
                expect(cached.stored.value.publicAction?.state).toBe('inactive')
                loadB.resolve()
                yield* TestHost.settle
                yield* router.navigate('/about')
                yield* TestHost.settle
                yield* PubSub.publish(source, queuedSnapshot(audioA.id))
                yield* TestHost.settle
                expect(membershipState(root).entries['audio:audio-a']?.status).toBe('active')
                revision = 19
                yield* router.navigate('/mixes/audio-a?fresh=1')
                yield* TestHost.settle
                expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
                  status: 'inactive',
                  revision: 19,
                  busy: false,
                })
                expect(root.all(Locator.attr('aria-label', 'Add to favorites'))).toHaveLength(2)
                expect(adapter.writes).toHaveLength(1)
              }),
              Layer.merge(
                rootLayer(async (input) => {
                  const url = new URL(new Request(input).url)

                  if (url.searchParams.has('late')) return late.promise
                  url.searchParams.delete('__data')

                  return Response.json(page(`${url.pathname}${url.search}`))
                }, adapter.layer),
                movingPlayerLayer(source),
              ),
            ),
          )
        }),
      ),
    )
  },
)

it('actual Root keeps the latest of two opposite acknowledged writes over a delayed active page DTO', async () => {
  const late = Promise.withResolvers<Response>()
  let writes = 0
  let revision = 17

  const adapter = membershipAdapter(
    async (body) => receipt(body.requestId, audioA.id, ++writes === 1, ++revision),
    async () => atomicStateResponse(revision),
  )

  await runWithLayer(
    Effect.gen(function* () {
      const router = yield* Router.Router
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, bootstrap())
      yield* TestHost.settle
      yield* openRetirementPlayer(root)
      yield* router.navigate('/mixes/audio-a?late=1')
      yield* TestHost.settle
      expect(retirementPlayerIdentity(root)).toEqual(listener)
      clickRetirementFavorite(root)
      yield* TestHost.settle
      clickRetirementFavorite(root, true)
      yield* TestHost.settle
      expect(adapter.writes.map(({ expectedRevision }) => expectedRevision)).toEqual([17, 18])
      expect(adapter.writes[0]?.requestId).not.toBe(adapter.writes[1]?.requestId)
      late.resolve(
        Response.json({
          ...page('/mixes/audio-a?late=1'),
          publicAction: document(audioA, 'active'),
        }),
      )
      yield* TestHost.settle
      expect(membershipState(root).entries['audio:audio-a']).toMatchObject({
        status: 'inactive',
        revision: 19,
        busy: false,
      })
      expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
      expect(root.all(Locator.attr('aria-label', 'Add to favorites'))).toHaveLength(2)
      const model = root.model()

      if (!model) throw new Error('Native Root stopped rendering')

      const cached = root.entry(GetPage, {
        path: '/mixes/audio-a?late=1',
        identity: model.identity,
        realm: bootstrap().realm,
      })

      if (!cached || !Predicate.isTagged(cached.stored, 'Success'))
        throw new Error('Missing actual active GetPage DTO in query cache')
      expect(cached.stored.value.publicAction?.state).toBe('active')
    }),
    rootLayer(
      async (input) =>
        new URL(new Request(input).url).searchParams.has('late')
          ? late.promise
          : Response.json(page('/mixes/audio-a')),
      adapter.layer,
    ),
  )
})
