import { Component } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Predicate, type PubSub, Schema, Stream } from 'effect'

import { PerformPlayer } from '../player/commands'
import { initialSnapshot, type PlayerSnapshot } from '../player/domain'
import { PlayerSnapshotSource } from '../player/subscriptions'
import { MembershipMessage, MembershipProps, MembershipProviderEvents } from './domain'
import { audioA, track } from './integration.test-support'
import { MembershipProviderModel, membershipProviderUpdate } from './provider'

export const RetirementMembershipState = Html.component({
  name: 'RetirementMembershipState',
  props: MembershipProps,
  model: MembershipProviderModel,
  message: MembershipMessage,
  events: MembershipProviderEvents,
}).make({
  init: ($) => ({
    principalId: $.props.principalId,
    principalKnown: $.props.principalKnown,
    generation: 0,
    revision: null,
    entries: {},
  }),
  update: ($) => $.combine(membershipProviderUpdate),
  view: (h) => h.text(''),
})

export const queuedSnapshot = (id: string): PlayerSnapshot => {
  const current = { ...track, id, slug: id, title: id }

  return { ...initialSnapshot, queue: { tracks: [current], currentIndex: 0, current } }
}

export const movingPlayerLayer = (source: PubSub.PubSub<PlayerSnapshot>) =>
  Layer.mergeAll(
    PerformPlayer.toLayer(() => Effect.succeed(Component.noop)),
    Layer.succeed(PlayerSnapshotSource, {
      snapshots: Stream.concat(
        Stream.succeed(queuedSnapshot(audioA.id)),
        Stream.fromPubSub(source),
      ),
    }),
  )

export const atomicStateResponse = (revision: number, active = false) =>
  Response.json({ revision, favorited: active, subscribed: false })

export const playerNotice = (root: TestHost.TestRoot<unknown, never, unknown>) => {
  const container = root.get(Locator.attr('data-target', 'player'))

  return Locator.attr('role', 'status').all(container).map(Locator.textOf).join(' ')
}

export const openRetirementPlayer = (root: TestHost.TestRoot<unknown, never, unknown>) =>
  Effect.gen(function* () {
    const opener = root
      .all(Locator.attr('aria-label', 'Now playing'))
      .find((node) => Predicate.isTagged(node, 'Element') && node.tag === 'button')

    if (!opener) throw new Error('Missing native player opener')
    Locator.fire(opener, 'click')
    yield* TestHost.settle
  })

export const clickRetirementFavorite = (
  root: TestHost.TestRoot<unknown, never, unknown>,
  active = false,
  consumer: 'player' | 'page' = 'player',
) => {
  const label = active ? 'Remove from favorites' : 'Add to favorites'
  const button = root.all(Locator.attr('aria-label', label)).at(consumer === 'player' ? -1 : 0)

  if (!button) throw new Error(`Missing native ${consumer} ${label}`)
  Locator.fire(button, 'click')
}

const Principal = Schema.Struct({
  principalId: Schema.NullOr(Schema.String),
  principalKnown: Schema.Boolean,
})

export const retirementPlayerIdentity = (root: TestHost.TestRoot<unknown, never, unknown>) => {
  const entry = root
    .log()
    .findLast(
      (entry) =>
        (Predicate.isTagged(entry, 'PropsChanged') || Predicate.isTagged(entry, 'Mounted')) &&
        entry.path.endsWith('/PlayerProvider[]'),
    )

  if (
    !entry ||
    (!Predicate.isTagged(entry, 'PropsChanged') && !Predicate.isTagged(entry, 'Mounted'))
  )
    throw new Error('Missing native PlayerProvider principal props')

  return Schema.decodeUnknownSync(Principal)(entry.props)
}
