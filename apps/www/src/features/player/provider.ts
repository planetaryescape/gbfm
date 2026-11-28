import { Command, Component } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Effect, Layer, Predicate, Stream } from 'effect'

import { isolatedPlayerClientLayer } from '../../player/runtime'
import { PerformPlayer } from './commands'
import {
  closeOverlays,
  initialModel,
  PlayerOperation,
  PlayerProviderEvents,
  PlayerProviderMessage,
  PlayerProviderModel,
  PlayerProviderProps,
} from './domain'
import { presentedSnapshot, visibleQueueIndices } from './privacy'
import { playerSnapshotLayer, PlayerSnapshotSource, subscriptions } from './subscriptions'

const PlayerProviderDef = Html.component({
  name: 'PlayerProvider',
  props: PlayerProviderProps,
  model: PlayerProviderModel,
  message: PlayerProviderMessage,
  events: PlayerProviderEvents,
  restore: false,
  shares: {
    value: ({ model, props }) => ({
      ...model,
      snapshot: presentedSnapshot(model, props),
      returnTo: props.returnTo,
      principalId: props.principalId,
      principalKnown: props.principalKnown,
    }),
    receives: [
      'RequestedPlayTrack',
      'RequestedPlayAll',
      'RequestedEnqueue',
      'RequestedEnqueueAll',
      'RequestedPlayIndex',
      'RequestedTogglePlayPause',
      'RequestedNext',
      'RequestedPrevious',
      'RequestedSeek',
      'RequestedJump',
      'RequestedVolume',
      'RequestedToggleMute',
      'RequestedRemove',
      'RequestedReorder',
      'RequestedClear',
      'RequestedToggleQueue',
      'RequestedCloseQueue',
      'RequestedToggleFullscreen',
      'RequestedCloseFullscreen',
      'RequestedCloseOverlays',
      'SettledFullscreen',
      'StartedPlayerDrag',
      'MovedPlayerDrag',
      'ReleasedPlayerDrag',
      'CancelledPlayerDrag',
      'PreviewedSeek',
      'CommittedSeek',
      'CancelledSeek',
    ],
  },
})

export const updatePlayerProvider = PlayerProviderDef.update({
  ChangedPrincipal: ($) =>
    $.run(
      PerformPlayer.make({
        operation: PlayerOperation.ConfirmPrincipal({
          principalId: $.props.principalId,
          principalKnown: $.props.principalKnown,
          authorizationSuspended: $.props.authorizationSuspended,
        }),
      }),
    ),
  ChangedPrivateAccess: ($, { access }) => $.evolve({ privateAccess: access }),
  ChangedSnapshot: ($, { snapshot }) => {
    const sameTrack = $.model.snapshot.queue.current?.id === snapshot.queue.current?.id
    const pendingSeek = sameTrack ? $.model.pendingSeek : null

    return $.evolve({
      snapshot: pendingSeek
        ? {
            ...snapshot,
            transport: { ...snapshot.transport, currentTime: pendingSeek.seconds },
          }
        : snapshot,
      pendingSeek,
      seekPreview: sameTrack ? $.model.seekPreview : null,
      hasHadTrack: $.model.hasHadTrack || snapshot.queue.current !== null,
    })
  },
  RequestedPlayTrack: ($, { track }) =>
    $.evolve({
      fullscreenOpen: true,
      fullscreenSettled: $.model.fullscreenOpen && $.model.fullscreenSettled,
      playerOffset: 0,
      playerDrag: null,
    }).run(PerformPlayer.make({ operation: PlayerOperation.PlayTrack({ track }) })),
  RequestedPlayAll: ($, { tracks }) =>
    $.evolve({
      fullscreenOpen: true,
      fullscreenSettled: $.model.fullscreenOpen && $.model.fullscreenSettled,
      playerOffset: 0,
      playerDrag: null,
    }).run(PerformPlayer.make({ operation: PlayerOperation.PlayAll({ tracks }) })),
  RequestedPlayIndex: ($, { index }) => {
    const actual = visibleQueueIndices($.model, $.props)[index]

    if (actual === undefined) return $.model

    return $.evolve({
      fullscreenOpen: true,
      fullscreenSettled: $.model.fullscreenOpen && $.model.fullscreenSettled,
      playerOffset: 0,
      playerDrag: null,
    }).run(PerformPlayer.make({ operation: PlayerOperation.PlayIndex({ index: actual }) }))
  },
  RequestedEnqueue: ($, { track }) =>
    $.run(PerformPlayer.make({ operation: PlayerOperation.Enqueue({ track }) })),
  RequestedEnqueueAll: ($, { tracks }) =>
    $.run(PerformPlayer.make({ operation: PlayerOperation.EnqueueAll({ tracks }) })),
  RequestedTogglePlayPause: ($) =>
    $.run(PerformPlayer.make({ operation: PlayerOperation.TogglePlayPause() })),
  RequestedNext: ($) => $.run(PerformPlayer.make({ operation: PlayerOperation.Next() })),
  RequestedPrevious: ($) => $.run(PerformPlayer.make({ operation: PlayerOperation.Previous() })),
  RequestedSeek: ($, { seconds }) => {
    const sequence = $.model.seekSequence + 1
    const trackId = $.model.snapshot.queue.current?.id

    const available =
      Number.isFinite($.model.snapshot.transport.duration) &&
      $.model.snapshot.transport.duration > 0

    return $.evolve({
      seekPreview: null,
      seekSequence: sequence,
      pendingSeek: available && trackId ? { sequence, seconds } : null,
      snapshot: available
        ? {
            ...$.model.snapshot,
            transport: { ...$.model.snapshot.transport, currentTime: seconds },
          }
        : $.model.snapshot,
    }).run(
      PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds }) }).pipe(
        Command.map(() =>
          available && trackId
            ? PlayerProviderMessage.CompletedSeek({ sequence, trackId })
            : Component.noop,
        ),
      ),
    )
  },
  CompletedSeek: ($, { sequence, trackId }) =>
    $.model.pendingSeek?.sequence === sequence && $.model.snapshot.queue.current?.id === trackId
      ? $.evolve({ pendingSeek: null })
      : $.model,
  RequestedJump: ($, { seconds }) =>
    $.run(PerformPlayer.make({ operation: PlayerOperation.Jump({ seconds }) })),
  RequestedVolume: ($, { volume }) =>
    $.run(PerformPlayer.make({ operation: PlayerOperation.Volume({ volume }) })),
  RequestedToggleMute: ($) =>
    $.run(PerformPlayer.make({ operation: PlayerOperation.ToggleMute() })),
  RequestedRemove: ($, { index }) => {
    const actual = visibleQueueIndices($.model, $.props)[index]

    return actual === undefined
      ? $.model
      : $.run(PerformPlayer.make({ operation: PlayerOperation.Remove({ index: actual }) }))
  },
  RequestedReorder: ($, { from, to }) => {
    const indices = visibleQueueIndices($.model, $.props)
    const actualFrom = indices[from]
    const actualTo = indices[to]

    return actualFrom === undefined || actualTo === undefined
      ? $.model
      : $.run(
          PerformPlayer.make({
            operation: PlayerOperation.Reorder({ from: actualFrom, to: actualTo }),
          }),
        )
  },
  RequestedClear: ($) =>
    $.set(closeOverlays($.model)).run(PerformPlayer.make({ operation: PlayerOperation.Clear() })),
  RequestedToggleQueue: ($) => $.evolve({ queueOpen: !$.model.queueOpen }),
  RequestedCloseQueue: ($) => $.evolve({ queueOpen: false }),
  RequestedToggleFullscreen: ($) =>
    $.model.fullscreenOpen
      ? $.set(closeOverlays($.model))
      : $.evolve({
          fullscreenOpen: true,
          fullscreenSettled: false,
          playerDrag: null,
          playerOffset: 0,
        }),
  RequestedCloseFullscreen: ($) => $.set(closeOverlays($.model)),
  RequestedCloseOverlays: ($) => $.set(closeOverlays($.model)),
  SettledFullscreen: ($, { open }) =>
    open === $.model.fullscreenOpen ? $.evolve({ fullscreenSettled: true }) : $.model,
  StartedPlayerDrag: ($, { pointerId, clientY }) => {
    if (!$.model.fullscreenOpen || !$.model.fullscreenSettled || $.model.playerDrag) return $.model

    return $.evolve({ playerDrag: { pointerId, startY: clientY - $.model.playerOffset } })
  },
  MovedPlayerDrag: ($, { pointerId, clientY }) =>
    $.model.playerDrag?.pointerId === pointerId
      ? $.evolve({ playerOffset: Math.max(0, clientY - $.model.playerDrag.startY) })
      : $.model,
  ReleasedPlayerDrag: ($, { pointerId, clientY, viewportHeight }) => {
    if ($.model.playerDrag?.pointerId !== pointerId) return $.model
    const offset = Math.max(0, clientY - $.model.playerDrag.startY)

    if (offset >= Math.min(160, viewportHeight * 0.2))
      return $.set({ ...closeOverlays($.model), playerOffset: offset })

    return $.evolve({ playerDrag: null, playerOffset: 0 })
  },
  CancelledPlayerDrag: ($) =>
    $.model.playerDrag ? $.evolve({ playerDrag: null, playerOffset: 0 }) : $.model,
  PreviewedSeek: ($, { trackId, seconds, fine, referenceSeconds, pointerRatio }) =>
    $.model.fullscreenOpen && $.model.snapshot.queue.current?.id === trackId
      ? $.evolve({ seekPreview: { seconds, fine, referenceSeconds, pointerRatio } })
      : $.model,
  CommittedSeek: ($, { trackId, seconds }) => {
    if (
      !$.model.fullscreenOpen ||
      $.model.seekPreview === null ||
      $.model.snapshot.queue.current?.id !== trackId
    )
      return $.model

    const sequence = $.model.seekSequence + 1

    return $.evolve({
      seekPreview: null,
      seekSequence: sequence,
      pendingSeek: { sequence, seconds },
      snapshot: {
        ...$.model.snapshot,
        transport: { ...$.model.snapshot.transport, currentTime: seconds },
      },
    }).run(
      PerformPlayer.make({ operation: PlayerOperation.Seek({ seconds }) }).pipe(
        Command.map(() => PlayerProviderMessage.CompletedSeek({ sequence, trackId })),
      ),
    )
  },
  CancelledSeek: ($, { trackId }) =>
    $.model.snapshot.queue.current?.id === trackId ? $.evolve({ seekPreview: null }) : $.model,
})

export const PlayerProvider = PlayerProviderDef.make({
  init: () => initialModel,
  update: updatePlayerProvider,
  subscriptions,
})

export const playerCommandsLayer = Layer.mergeAll(PerformPlayer.layer, playerSnapshotLayer)

export const playerServerLayer = Layer.mergeAll(
  Layer.succeed(PlayerSnapshotSource, { snapshots: Stream.empty }),
  PerformPlayer.toLayer(({ operation }) =>
    Predicate.isTagged(operation, 'ConfirmPrincipal')
      ? Effect.succeed(Component.noop)
      : Effect.die(new Error('Browser playback commands cannot execute during server rendering.')),
  ),
)

export const nativePlayerClientLayer = playerCommandsLayer.pipe(
  Layer.provideMerge(isolatedPlayerClientLayer),
)

export const nativePlayerServerLayer = playerServerLayer

export {
  PlayerProviderMessage,
  PlayerProviderMessage as PlayerMessage,
  PlayerProviderMessage as PlayerIntent,
} from './domain'
