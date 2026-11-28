import { Html } from '@effect/ui/html'
import { Story } from '@effect/ui/testing'
import { it, expect } from '@effect/vitest'
import { Effect } from 'effect'

import { LoadMembership, SaveMembership } from './commands'
import { MembershipModel, MembershipProps, MembershipProviderEvents } from './domain'
import { MembershipMessage, membershipUpdate } from './provider'

const MembershipHarness = Html.component({
  name: 'MembershipHarness',
  props: MembershipProps,
  model: MembershipModel,
  message: MembershipMessage,
  events: MembershipProviderEvents,
}).make({
  init: ($) => ({ ...$.props, generation: 0, revision: null, entries: {} }),
  update: ($) => $.combine(membershipUpdate),
  view: (h) => h.div,
})

const audio = { kind: 'audio', id: 'audio-1' } satisfies { kind: 'audio'; id: string }

const show = { kind: 'show', id: 'show-1' } satisfies { kind: 'show'; id: string }

const principal = { principalId: 'listener-a', principalKnown: true }

it('one owner advances the listener revision for audio and show consumers', () =>
  Effect.gen(function* () {
    const s = yield* Story.make(MembershipHarness, principal)
    s.send(MembershipMessage.RequestedMembership({ target: audio }))
      .expectExact(
        LoadMembership.make({
          target: audio,
          principalId: 'listener-a',
          generation: 0,
          request: 1,
        }),
      )
      .resolve(
        LoadMembership,
        MembershipMessage.SucceededLoadMembership({
          target: audio,
          principalId: 'listener-a',
          generation: 0,
          request: 1,
          active: false,
          revision: 3,
        }),
      )
      .send(MembershipMessage.RequestedMembership({ target: show }))
      .resolve(
        LoadMembership,
        MembershipMessage.SucceededLoadMembership({
          target: show,
          principalId: 'listener-a',
          generation: 0,
          request: 1,
          active: true,
          revision: 3,
        }),
      )
      .send(MembershipMessage.RequestedToggleMembership({ target: audio }))
      .expectExact(
        SaveMembership.make({
          target: audio,
          principalId: 'listener-a',
          generation: 0,
          request: 2,
          active: true,
          expectedRevision: 3,
          mutationId: null,
        }),
      )
      .resolve(
        SaveMembership,
        MembershipMessage.SucceededSaveMembership({
          target: audio,
          principalId: 'listener-a',
          generation: 0,
          request: 2,
          active: true,
          revision: 4,
        }),
      )
      .expectNone()
    expect(s.model.entries['audio:audio-1']?.status).toBe('active')
    expect(s.model.entries['show:show-1']?.revision).toBe(4)
  }).pipe(Effect.scoped, Effect.runPromise))

it('lost acknowledgements retry the exact mutation and block unrelated writes', () =>
  Effect.gen(function* () {
    const s = yield* Story.make(MembershipHarness, principal)
    s.given({
      ...principal,
      generation: 0,
      revision: 5,
      entries: {
        'audio:audio-1': {
          target: audio,
          status: 'inactive',
          busy: false,
          revision: 5,
          request: 1,
          mutationId: null,
          notice: null,
        },
        'show:show-1': {
          target: show,
          status: 'inactive',
          busy: false,
          revision: 5,
          request: 1,
          mutationId: null,
          notice: null,
        },
      },
    })
      .send(MembershipMessage.RequestedToggleMembership({ target: audio }))
      .resolve(
        SaveMembership,
        MembershipMessage.FailedSaveMembership({
          target: audio,
          principalId: 'listener-a',
          generation: 0,
          request: 2,
          mutationId: 'same-operation',
          unauthorized: false,
          conflicted: false,
        }),
      )
      .send(MembershipMessage.RequestedToggleMembership({ target: show }))
      .expectNone()
      .send(MembershipMessage.RequestedToggleMembership({ target: audio }))
      .expectExact(
        SaveMembership.make({
          target: audio,
          principalId: 'listener-a',
          generation: 0,
          request: 3,
          active: true,
          expectedRevision: 5,
          mutationId: 'same-operation',
        }),
      )
      .resolve(
        SaveMembership,
        MembershipMessage.SucceededSaveMembership({
          target: audio,
          principalId: 'listener-a',
          generation: 0,
          request: 3,
          active: true,
          revision: 6,
        }),
      )
    expect(s.model.entries['audio:audio-1']?.mutationId).toBeNull()
  }).pipe(Effect.scoped, Effect.runPromise))

it('a late response cannot cross a principal change before its subscription runs', () =>
  Effect.gen(function* () {
    const s = yield* Story.make(MembershipHarness, principal)
    s.send(MembershipMessage.RequestedMembership({ target: audio }))
      .props({ principalId: 'listener-b', principalKnown: true })
      .resolve(
        LoadMembership,
        MembershipMessage.SucceededLoadMembership({
          target: audio,
          principalId: 'listener-a',
          generation: 0,
          request: 1,
          active: true,
          revision: 7,
        }),
      )
    expect(s.model.entries['audio:audio-1']?.status).toBe('loading')
    s.send(MembershipMessage.ChangedPrincipal({ principalId: 'listener-b', principalKnown: true }))
    expect(s.model.entries).toEqual({})
    expect(s.model.generation).toBe(1)
  }).pipe(Effect.scoped, Effect.runPromise))
