import { Router, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Exit, Schema, Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  beginSave,
  completeSave,
  creatorModel,
  expectWritingAbsent,
  makeCreatorLeaseFixture,
  mountWriting,
  privateTitle,
  runCreatorLease,
} from './creator-lease.retirement.test-support'
import {
  AppBootstrap,
  RoutedApplicationMessage,
  RoutedApplicationNoDeps,
} from './routed-application'
import { fieldValue, input, submitCreator } from './routed-feature-lifetime.test-support'
import { pumpReaderUntil } from './routed-reader-lifetime.test-support'

const RealmMessage = UiSchema.TaggedEnum({ ChangedRealm: {} })

const RealmHost = Html.component({
  name: 'CreatorLeaseRealmHost',
  props: AppBootstrap,
  model: Schema.Struct({ realm: Schema.String }),
  message: RealmMessage,
}).make({
  init: ({ props }) => ({ realm: props.realm }),
  update: { ChangedRealm: ($) => $.evolve({ realm: 'unrelated-verification-realm' }) },
  view: (h, model) =>
    RoutedApplicationNoDeps(h, {
      props: { ...h.props, realm: model.realm },
    }),
})

describe('Root Creator lease terminal, realm, history and remount boundaries', () => {
  it.each(['success', 'failure'])(
    'revokes current401 before late save %s without claiming anonymous identity',
    async (outcome) => {
      const fixture = makeCreatorLeaseFixture('/new/editorial')
      await runCreatorLease(
        fixture,
        Effect.gen(function* () {
          const root = yield* mountWriting(fixture)
          yield* beginSave(root, fixture)
          const verification = fixture.hold()
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* pumpReaderUntil(() => verification.started())
          const currentPrincipal = fixture.hold()
          verification.respond(
            Response.json(fixture.document(undefined, null, false, 401), { status: 401 }),
          )
          yield* pumpReaderUntil(() => currentPrincipal.started())
          expectWritingAbsent(root)
          expect(root.model()?.creatorLease).toBeNull()
          expect(root.model()?.membershipPrincipalKnown).toBe(false)
          expect(root.model()?.membershipPrincipalId).toBeNull()
          expect(fixture.saves[0]?.aborted()).toBe(true)
          completeSave(fixture, outcome)
          yield* TestHost.settle
          expectWritingAbsent(root)
          currentPrincipal.respond(
            Response.json(fixture.document(undefined, null, false, 401), { status: 401 }),
          )
          yield* TestHost.settle
          expect(root.model()?.membershipPrincipalKnown).toBe(false)
          expect(root.model()?.creatorLease).toBeNull()
          expectWritingAbsent(root)
          expect(fixture.writes).toHaveLength(1)
          expect(fixture.requests).toHaveLength(3)
        }),
      )
    },
  )

  it.each(['success', 'failure'])(
    'ends the editor on terminal verification failure before late save %s',
    async (outcome) => {
      const fixture = makeCreatorLeaseFixture('/new/editorial')
      await runCreatorLease(
        fixture,
        Effect.gen(function* () {
          const root = yield* mountWriting(fixture)
          yield* beginSave(root, fixture)
          const verification = fixture.hold()
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* pumpReaderUntil(() => verification.started())
          const lease = root.model()?.creatorLease

          if (!lease) throw new Error('Missing current lease')
          verification.respond(
            Response.json(fixture.document(undefined, 'owner-a', true, 503), { status: 503 }),
          )
          yield* TestHost.settle
          expectWritingAbsent(root)
          expect(root.model()?.creatorLease).toBeNull()
          expect(fixture.saves[0]?.aborted()).toBe(true)
          completeSave(fixture, outcome)
          yield* TestHost.settle
          root.send(RoutedApplicationMessage.RequestedCreatorRefresh({ lease }))
          yield* TestHost.settle
          expectWritingAbsent(root)
          expect(fixture.requests).toHaveLength(2)
          expect(fixture.writes).toHaveLength(1)
        }),
      )
    },
  )

  it.each(['success', 'failure'])(
    'superseding plain verification revokes the old scope and rejects late save %s',
    async (outcome) => {
      const fixture = makeCreatorLeaseFixture('/new/editorial')
      await runCreatorLease(
        fixture,
        Effect.gen(function* () {
          const root = yield* mountWriting(fixture)
          yield* beginSave(root, fixture)
          const first = fixture.hold()
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* pumpReaderUntil(() => first.started())
          const second = fixture.hold()
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* pumpReaderUntil(() => second.started())
          expectWritingAbsent(root)
          expect(fixture.saves[0]?.aborted()).toBe(true)
          first.respond(Response.json(fixture.document()))
          yield* TestHost.settle
          expectWritingAbsent(root)
          second.respond(Response.json(fixture.document()))
          yield* TestHost.settle
          expect(fieldValue(root, 'title')).toBe('')
          input(root, 'title', 'Replacement after superseding verification')
          yield* TestHost.settle
          completeSave(fixture, outcome)
          yield* TestHost.settle
          expect(fieldValue(root, 'title')).toBe('Replacement after superseding verification')
          expect(fixture.writes).toHaveLength(1)
        }),
      )
    },
  )

  it.each(['success', 'failure'])(
    'same Root realm change revokes the verified editor before late save %s',
    async (outcome) => {
      const fixture = makeCreatorLeaseFixture('/new/editorial')
      await runCreatorLease(
        fixture,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(RealmHost, fixture.props)
          yield* TestHost.settle
          Locator.fire(root.get(Locator.attr('name', 'title')), 'input', { value: privateTitle })
          yield* TestHost.settle
          yield* beginSave(root, fixture)
          root.send(RealmMessage.ChangedRealm())
          yield* TestHost.settle
          expectWritingAbsent(root)
          expect(fixture.saves[0]?.aborted()).toBe(true)
          completeSave(fixture, outcome)
          yield* TestHost.settle
          expectWritingAbsent(root)
          expect(fixture.writes).toHaveLength(1)
        }),
      )
    },
  )

  it.each(['success', 'failure'])(
    'Root remount never restores the revoked editor or late save %s',
    async (outcome) => {
      const fixture = makeCreatorLeaseFixture('/new/editorial')
      await runCreatorLease(
        fixture,
        Effect.gen(function* () {
          const scope = yield* Scope.fork(yield* Scope.Scope)
          const old = yield* mountWriting(fixture).pipe(Effect.provideService(Scope.Scope, scope))
          yield* beginSave(old, fixture)
          const verification = fixture.hold()
          old.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* pumpReaderUntil(() => verification.started())
          yield* Scope.close(scope, Exit.void)
          expect(fixture.saves[0]?.aborted()).toBe(true)
          fixture.account('owner-b')
          const freshGate = fixture.hold()

          const fresh = yield* TestHost.mount(RoutedApplicationNoDeps, {
            ...fixture.props,
            identity: { known: false, principalId: null, epoch: 2 },
          })

          yield* pumpReaderUntil(() => freshGate.started())
          expectWritingAbsent(fresh)
          verification.respond(Response.json(fixture.document(undefined, 'owner-a')))
          yield* TestHost.settle
          expectWritingAbsent(fresh)
          freshGate.respond(Response.json(fixture.document()))
          yield* TestHost.settle
          expect(fieldValue(fresh, 'title')).toBe('')
          input(fresh, 'title', 'Fresh remounted writing')
          yield* TestHost.settle
          submitCreator(fresh)
          yield* pumpReaderUntil(() => fixture.saves[1]?.started())
          const pending = creatorModel(fresh, 'owner-b')
          completeSave(fixture, outcome)
          yield* TestHost.settle
          expect(creatorModel(fresh, 'owner-b')).toEqual(pending)
          expect(fieldValue(fresh, 'title')).toBe('Fresh remounted writing')
          completeSave(fixture, 'failure', 1)
          yield* TestHost.settle
          expect(fixture.writes).toHaveLength(2)
        }),
      )
    },
  )

  it.each(['success', 'failure'])(
    'named remote edit retains its actual editor through verification and save %s',
    async (outcome) => {
      const fixture = makeCreatorLeaseFixture('/new/editorial?edit=existing')
      await runCreatorLease(
        fixture,
        Effect.gen(function* () {
          const root = yield* mountWriting(fixture)
          yield* beginSave(root, fixture)
          const verification = fixture.hold()
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* pumpReaderUntil(() => verification.started())
          expectWritingAbsent(root)
          completeSave(fixture, outcome)
          yield* TestHost.settle
          expectWritingAbsent(root)
          verification.respond(Response.json(fixture.document()))
          yield* TestHost.settle
          expect(fieldValue(root, 'title')).toBe(privateTitle)
          expect(creatorModel(root).saving).toBe(false)
          expect(fixture.apiRequests.filter((path) => path.endsWith('/edit'))).toHaveLength(1)
          expect(fixture.writes).toHaveLength(1)
        }),
      )
    },
  )

  it.each(['success', 'failure'])(
    'history cannot restore A writing under B or accept a departed save %s',
    async (outcome) => {
      const fixture = makeCreatorLeaseFixture('/new/editorial')
      await runCreatorLease(
        fixture,
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* mountWriting(fixture)
          yield* beginSave(root, fixture)
          const verification = fixture.hold()
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* pumpReaderUntil(() => verification.started())
          yield* router.navigate('/about')
          yield* TestHost.settle
          expect(root.query(Locator.attr('name', 'title'))).toBeUndefined()
          expect(fixture.saves[0]?.aborted()).toBe(true)
          fixture.account('owner-b')
          const returning = fixture.hold()
          yield* router.back
          yield* pumpReaderUntil(() => returning.started())
          expectWritingAbsent(root)
          verification.respond(Response.json(fixture.document(undefined, 'owner-a')))
          yield* TestHost.settle
          expectWritingAbsent(root)
          returning.respond(Response.json(fixture.document()))
          yield* TestHost.settle
          expect(fieldValue(root, 'title')).toBe('')
          input(root, 'title', 'B independent history writing')
          yield* TestHost.settle
          completeSave(fixture, outcome)
          yield* TestHost.settle
          expect(fieldValue(root, 'title')).toBe('B independent history writing')
          expect(root.model()?.creatorLease?.ownerId).toBe('owner-b')
          expect(fixture.writes).toHaveLength(1)
        }),
      )
    },
  )
})
