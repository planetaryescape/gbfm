import { Command, Component } from '@effect/ui'
import { Effect } from 'effect'

import { PlayerClient } from '../../player/runtime'
import { PlayerOperation } from './domain'
import { isPrivateTrack } from './privacy'

export class PerformPlayer extends Command.Service<PerformPlayer>()('player/PerformPlayer', {
  args: { operation: PlayerOperation },
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.map(
      PlayerClient,
      ({ controller, privateAccess }) =>
        ({ operation }) =>
          PlayerOperation.match(operation, {
            ConfirmPrincipal: ({ principalId, principalKnown, authorizationSuspended }) =>
              Effect.gen(function* () {
                if (!privateAccess) return

                const changed = yield* authorizationSuspended
                  ? privateAccess.suspendAuthorization
                  : privateAccess.confirmPrincipal(principalId, principalKnown)

                if (!changed) return
                const revision = privateAccess.getSnapshot().revision
                const snapshot = controller.getSnapshot()

                if (snapshot.queue.current && isPrivateTrack(snapshot.queue.current))
                  yield* controller.pause

                for (let index = snapshot.queue.tracks.length - 1; index >= 0; index--) {
                  if (privateAccess.getSnapshot().revision !== revision) return
                  const track = snapshot.queue.tracks[index]

                  if (
                    track &&
                    controller.getSnapshot().queue.tracks[index] === track &&
                    isPrivateTrack(track)
                  )
                    yield* controller.removeFromQueue(index)
                }
              }),
            PlayTrack: ({ track }) => controller.playTrack(track),
            PlayAll: ({ tracks }) => controller.playAll(tracks),
            Enqueue: ({ track }) => controller.enqueue(track),
            EnqueueAll: ({ tracks }) => controller.enqueueAll(tracks),
            PlayIndex: ({ index }) => controller.playFromQueue(index),
            TogglePlayPause: () => controller.togglePlayPause,
            Next: () => controller.playNext,
            Previous: () => controller.playPrevious,
            Seek: ({ seconds }) => controller.seekTo(seconds),
            Jump: ({ seconds }) =>
              seconds >= 0 ? controller.jumpForward(seconds) : controller.jumpBackward(-seconds),
            Volume: ({ volume }) => controller.setVolume(volume),
            ToggleMute: () => controller.toggleMute,
            Remove: ({ index }) => controller.removeFromQueue(index),
            Reorder: ({ from, to }) => controller.reorderQueue(from, to),
            Clear: () => controller.clearQueue,
          }).pipe(Effect.as(Component.noop)),
    ),
  )
}
