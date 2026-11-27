import { Subscription } from '@effect/ui'
import { Context, Effect, Layer, Queue, Stream } from 'effect'

import { PlayerClient } from '../../player/runtime'
import type { PrivatePlaybackSnapshot } from '../../player/runtime'
import { PlayerProviderMessage, type PlayerSnapshot, type PlayerProviderProps } from './domain'

export class PlayerSnapshotSource extends Context.Service<
  PlayerSnapshotSource,
  {
    readonly snapshots: Stream.Stream<PlayerSnapshot>
    readonly privateAccess?: Stream.Stream<PrivatePlaybackSnapshot>
  }
>()('player/PlayerSnapshotSource') {}

export const playerSnapshotLayer = Layer.effect(
  PlayerSnapshotSource,
  Effect.map(PlayerClient, ({ controller, privateAccess }) => ({
    privateAccess: privateAccess
      ? Stream.callback<PrivatePlaybackSnapshot>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() =>
              privateAccess.subscribe((access) => {
                Queue.offerUnsafe(queue, access)
              }),
            ),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        )
      : Stream.empty,
    snapshots: Stream.callback<PlayerSnapshot>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          controller.subscribeSnapshot((snapshot) => Queue.offerUnsafe(queue, snapshot)),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    ),
  })),
)

export const subscriptions = ({ props }: { readonly props: PlayerProviderProps }) => [
  Subscription.make('playerPrincipal', [props.principalKnown, props.principalId], () =>
    Stream.succeed(PlayerProviderMessage.ChangedPrincipal()),
  ),
  Subscription.make(
    'playerSnapshots',
    Stream.unwrap(
      Effect.map(PlayerSnapshotSource, ({ snapshots, privateAccess }) =>
        snapshots.pipe(
          Stream.map((snapshot) => PlayerProviderMessage.ChangedSnapshot({ snapshot })),
          Stream.merge(
            (privateAccess ?? Stream.empty).pipe(
              Stream.map((access) => PlayerProviderMessage.ChangedPrivateAccess({ access })),
            ),
          ),
        ),
      ),
    ),
  ),
]
