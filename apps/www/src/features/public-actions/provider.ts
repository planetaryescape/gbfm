import { Subscription } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Match, Predicate, Schema, Stream } from 'effect'

import { LoadMembership, SaveMembership } from './commands'
import {
  acceptsMembership,
  advanceMembershipRevision,
  MembershipMessage,
  MembershipModel,
  MembershipProps,
  MembershipProviderEvents,
  membershipKey,
  type MembershipEntry,
} from './domain'

export const MembershipProviderModel = Schema.Struct({
  ...MembershipModel.fields,
  navigation: Schema.optional(
    Schema.Struct({
      navigationId: Schema.Number,
      pending: Schema.Boolean,
      revision: Schema.NullOr(Schema.Number),
    }),
  ),
})

export const MembershipProviderDefinition = Html.component({
  name: 'MembershipProvider',
  props: MembershipProps,
  model: MembershipProviderModel,
  message: MembershipMessage,
  events: MembershipProviderEvents,
  restore: false,
  shares: {
    value: ({ model, props }) =>
      model.principalId === props.principalId && model.principalKnown === props.principalKnown
        ? {
            principalId: model.principalId,
            principalKnown: model.principalKnown,
            generation: model.generation,
            revision: model.revision,
            entries: model.entries,
          }
        : {
            principalId: null,
            principalKnown: false,
            generation: model.generation,
            revision: null,
            entries: {},
          },
    receives: ['RequestedMembership', 'RequestedToggleMembership', 'RequestedRetryMembership'],
  },
})

export const membershipUpdate = MembershipProviderDefinition.update(($, message) => {
  if (Predicate.isTagged(message, 'ChangedPrincipal')) {
    if (
      message.principalId !== $.props.principalId ||
      message.principalKnown !== $.props.principalKnown
    )
      return $.model

    if (
      message.principalId === $.model.principalId &&
      message.principalKnown === $.model.principalKnown
    )
      return $.model

    return $.evolve({
      principalId: message.principalId,
      principalKnown: message.principalKnown,
      generation: $.model.generation + 1,
      revision: null,
      entries: {},
      navigation: undefined,
    })
  }

  if (
    $.props.principalId !== $.model.principalId ||
    $.props.principalKnown !== $.model.principalKnown
  )
    return $.model

  if (MembershipMessage.guards.ChangedMembershipLifecycle(message)) return $.model
  const target = message.target
  const key = membershipKey(target)
  const entry = $.model.entries[key]

  const put = (value: MembershipEntry) =>
    $.evolve({ entries: { ...$.model.entries, [key]: value } })

  if (
    Predicate.isTagged(message, 'RequestedMembership') ||
    Predicate.isTagged(message, 'RequestedRetryMembership')
  ) {
    if (Predicate.isTagged(message, 'RequestedRetryMembership') && !$.model.principalKnown)
      return $.emit(MembershipProviderEvents.RequestedPrincipalRefresh())

    if (entry?.busy || (Predicate.isTagged(message, 'RequestedMembership') && entry)) return $.model

    const next: MembershipEntry = {
      target,
      status: 'loading',
      busy: true,
      revision: null,
      mutationId: null,
      request: (entry?.request ?? 0) + 1,
      notice: null,
    }

    if (!$.model.principalId || !$.model.principalKnown)
      return put({
        ...next,
        busy: false,
        status: $.model.principalKnown ? 'anonymous' : 'unavailable',
      })

    return put(next).run(
      LoadMembership.make({
        target,
        principalId: $.model.principalId,
        generation: $.model.generation,
        request: next.request,
      }),
    )
  }

  if (Predicate.isTagged(message, 'RequestedToggleMembership')) {
    if (
      !entry ||
      entry.busy ||
      entry.revision === null ||
      !$.model.principalId ||
      !['active', 'inactive'].includes(entry.status)
    )
      return $.model

    if (
      Object.entries($.model.entries).some(
        ([otherKey, other]) =>
          otherKey !== key &&
          ((other.busy && other.revision !== null) || other.mutationId !== null),
      )
    )
      return $.model

    return put({ ...entry, busy: true, request: entry.request + 1, notice: null }).run(
      SaveMembership.make({
        target,
        principalId: $.model.principalId,
        generation: $.model.generation,
        request: entry.request + 1,
        active: entry.status === 'inactive',
        expectedRevision: entry.revision,
        mutationId: entry.mutationId,
      }),
    )
  }

  if (!entry || !acceptsMembership($.model, message)) return $.model

  if (
    (Predicate.isTagged(message, 'FailedLoadMembership') ||
      Predicate.isTagged(message, 'FailedSaveMembership')) &&
    message.unauthorized
  ) {
    return $.evolve({
      generation: $.model.generation + 1,
      revision: null,
      entries: Object.fromEntries(
        Object.entries($.model.entries).map(([entryKey, value]) => [
          entryKey,
          {
            ...value,
            busy: false,
            status: 'anonymous',
            revision: null,
            mutationId: null,
            notice: 'Sign in to continue.',
          },
        ]),
      ),
    })
  }

  return Match.value(message).pipe(
    Match.tag('SucceededLoadMembership', (message) => {
      if (entry.revision !== null) return $.model

      if ($.model.revision !== null && message.revision < $.model.revision) {
        return put({ ...entry, request: entry.request + 1 }).run(
          LoadMembership.make({
            target,
            principalId: message.principalId,
            generation: message.generation,
            request: entry.request + 1,
          }),
        )
      }

      return $.evolve({
        revision: message.revision,
        entries: advanceMembershipRevision(
          {
            ...$.model.entries,
            [key]: {
              ...entry,
              busy: false,
              status: message.active ? 'active' : 'inactive',
              revision: message.revision,
              mutationId: null,
            },
          },
          message.revision,
        ),
      })
    }),
    Match.tag('FailedLoadMembership', (message) =>
      put({
        ...entry,
        busy: false,
        status: message.unauthorized ? 'anonymous' : 'unavailable',
        revision: null,
      }),
    ),
    Match.tag('SucceededSaveMembership', (message) => {
      if (entry.revision === null || message.revision !== entry.revision + 1) return $.model

      return $.evolve({
        revision: Math.max($.model.revision ?? 0, message.revision),
        entries: advanceMembershipRevision(
          {
            ...$.model.entries,
            [key]: {
              ...entry,
              busy: false,
              status: message.active ? 'active' : 'inactive',
              revision: message.revision,
              mutationId: null,
              notice: 'Saved',
            },
          },
          Math.max($.model.revision ?? 0, message.revision),
        ),
      })
    }),
    Match.tag('FailedSaveMembership', (message) => {
      if (message.conflicted)
        return put({
          ...entry,
          busy: true,
          status: 'loading',
          request: entry.request + 1,
          revision: null,
          mutationId: null,
          notice: 'Saved state changed. Review it and try again.',
        }).run(
          LoadMembership.make({
            target,
            principalId: message.principalId,
            generation: message.generation,
            request: entry.request + 1,
          }),
        )

      return put({
        ...entry,
        busy: false,
        mutationId: message.mutationId,
        notice: 'Could not save. Try again.',
      })
    }),
    Match.exhaustive,
  )
})

const membershipLifecycleUpdate = MembershipProviderDefinition.update(($) => {
  const lifecycle = $.props.lifecycle

  if (
    !lifecycle ||
    $.props.principalId !== $.model.principalId ||
    $.props.principalKnown !== $.model.principalKnown
  )
    return $.model
  const held = $.model.navigation

  if (held && lifecycle.navigationId < held.navigationId) return $.model

  if (!held || held.navigationId !== lifecycle.navigationId)
    return $.evolve({ navigation: { ...lifecycle, revision: $.model.revision } })

  if (held.pending === lifecycle.pending) return $.model
  const navigation = { ...held, pending: lifecycle.pending }

  if (lifecycle.pending)
    return $.evolve({ navigation: { ...navigation, revision: $.model.revision } })

  if (
    !$.model.principalId ||
    !$.model.principalKnown ||
    held.revision !== $.model.revision ||
    Object.values($.model.entries).some((entry) => entry.busy || entry.mutationId !== null)
  )
    return $.evolve({ navigation })
  const principalId = $.model.principalId

  const entries = Object.fromEntries(
    Object.entries($.model.entries).map(([key, entry]) => [
      key,
      {
        ...entry,
        status: 'loading',
        busy: true,
        revision: null,
        request: entry.request + 1,
        notice: null,
      } satisfies MembershipEntry,
    ]),
  )

  return $.evolve({ navigation, entries }).run(
    ...Object.values(entries).map((entry) =>
      LoadMembership.make({
        target: entry.target,
        principalId,
        generation: $.model.generation,
        request: entry.request,
      }),
    ),
  )
})

export const membershipProviderUpdate = MembershipProviderDefinition.update(($) =>
  $.combine(membershipLifecycleUpdate, membershipUpdate),
)

export const MembershipProviderNoDeps = MembershipProviderDefinition.make({
  init: ($) => ({
    principalId: $.props.principalId,
    principalKnown: $.props.principalKnown,
    generation: 0,
    revision: null,
    entries: {},
  }),
  subscriptions: ($) => [
    Subscription.make('MembershipIdentity', [$.props.principalId, $.props.principalKnown], () =>
      Stream.succeed(MembershipMessage.ChangedPrincipal($.props)),
    ),
    ...($.props.lifecycle
      ? [
          Subscription.make(
            'MembershipLifecycle',
            [$.props.lifecycle.navigationId, $.props.lifecycle.pending, $.model.generation],
            () => Stream.succeed(MembershipMessage.ChangedMembershipLifecycle()),
          ),
        ]
      : []),
  ],
  update: ($) => $.combine(membershipProviderUpdate),
})

export const MembershipProvider = MembershipProviderNoDeps

export { MembershipMessage, MembershipTarget, membershipKey } from './domain'

export { MembershipProviderEvents } from './domain'

export { membershipCommandsLayer } from './commands'
