import * as Dialog from '@foldkit/ui/dialog'
import { MembershipRevision } from '@gbfm/api/favorites'
import { QueueTrack, type PlaybackSnapshot } from '@gbfm/player'
import { Effect, Option, Schema } from 'effect'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { dragOffset, SheetDrag, shouldDismiss, startDrag } from '../sheet-drag'
import * as Favorite from './favorite'
import { PlayerClient, type PlayerClientValue } from './runtime'

const QueueView = Schema.Struct({
  tracks: Schema.Array(QueueTrack),
  currentIndex: Schema.Number,
  current: Schema.NullOr(QueueTrack),
})

const Transport = Schema.Struct({
  isInitialized: Schema.Boolean,
  isLoaded: Schema.Boolean,
  isPlaying: Schema.Boolean,
  isBuffering: Schema.Boolean,
  currentTime: Schema.Number,
  duration: Schema.Number,
})

const Volume = Schema.Struct({ volume: Schema.Number, isMuted: Schema.Boolean })

export const Snapshot = Schema.Struct({ queue: QueueView, transport: Transport, volume: Volume })

export const Model = Schema.Struct({
  snapshot: Snapshot,
  queueDialog: Dialog.Model,
  playerDialog: Dialog.Model,
  draggedIndex: Schema.NullOr(Schema.Number),
  playerDrag: SheetDrag,
  playerOffset: Schema.Number,
  hasHadTrack: Schema.Boolean,
  favorite: Favorite.Model,
})

export type Model = typeof Model.Type

export const initialSnapshot: PlaybackSnapshot = {
  queue: { tracks: [], currentIndex: -1, current: null },
  transport: {
    isInitialized: false,
    isLoaded: false,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
  },
  volume: { volume: 100, isMuted: false },
}

export const initialModel: Model = {
  snapshot: initialSnapshot,
  queueDialog: Dialog.init({ id: 'playback-queue' }),
  playerDialog: Dialog.init({ id: 'fullscreen-player', isAnimated: true }),
  draggedIndex: null,
  playerDrag: null,
  playerOffset: 0,
  hasHadTrack: false,
  favorite: Favorite.initialModel,
}

export const Message = defineMessageUnion({
  SnapshotChanged: { snapshot: Snapshot },
  TogglePlayPause: {},
  SeekTo: { seconds: Schema.Number },
  Jump: { seconds: Schema.Number },
  SetVolume: { volume: Schema.Number },
  ToggleMute: {},
  PlayTrack: { track: QueueTrack },
  PlayAll: { tracks: Schema.Array(QueueTrack) },
  Enqueue: { track: QueueTrack },
  EnqueueAll: { tracks: Schema.Array(QueueTrack) },
  PlayIndex: { index: Schema.Number },
  Next: {},
  Previous: {},
  Remove: { index: Schema.Number },
  Reorder: { from: Schema.Number, to: Schema.Number },
  Clear: {},
  GotQueueDialogMessage: { message: Dialog.Message },
  GotPlayerDialogMessage: { message: Dialog.Message },
  ToggleQueue: {},
  CloseQueue: {},
  ToggleFullscreen: {},
  CloseFullscreen: {},
  PlayerDragStarted: { pointerId: Schema.Number, clientY: Schema.Number },
  PlayerDragMoved: { pointerId: Schema.Number, clientY: Schema.Number },
  PlayerDragReleased: {
    pointerId: Schema.Number,
    clientY: Schema.Number,
    viewportHeight: Schema.Number,
  },
  PlayerDragCancelled: {},
  DragStarted: { index: Schema.Number },
  DroppedAt: { index: Schema.Number },
  OperationCompleted: {},
  GotFavoriteMessage: { message: Favorite.Message },
  PrincipalChanged: { principalId: Schema.NullOr(Schema.String), principalKnown: Schema.Boolean },
  FavoriteChangedElsewhere: {
    audioId: Schema.String,
    active: Schema.Boolean,
    revision: MembershipRevision,
  },
})

export type Message = typeof Message.Type

const operation = <A>(
  name: string,
  fields: Schema.Struct.Fields,
  run: (client: PlayerClientValue, args: A) => Effect.Effect<void>,
) =>
  Command.define(name, {
    args: fields,
    messages: [Message.OperationCompleted],
    execute: (args) =>
      PlayerClient.pipe(
        // SAFETY: each private command definition supplies fields matching A.
        // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
        Effect.flatMap((client) => run(client, args as A)),
        Effect.as(Message.OperationCompleted()),
      ),
  })

const noArgOperation = (name: string, run: (client: PlayerClientValue) => Effect.Effect<void>) =>
  Command.define(name, {
    messages: [Message.OperationCompleted],
    execute: PlayerClient.pipe(Effect.flatMap(run), Effect.as(Message.OperationCompleted())),
  })

const Toggle = noArgOperation('PlayerToggle', (client) => client.controller.togglePlayPause)

const Next = noArgOperation('PlayerNext', (client) => client.controller.playNext)

const Previous = noArgOperation('PlayerPrevious', (client) => client.controller.playPrevious)

const Clear = noArgOperation('PlayerClear', (client) => client.controller.clearQueue)

const ToggleMute = noArgOperation('PlayerToggleMute', (client) => client.controller.toggleMute)

const Seek = operation<{ seconds: number }>(
  'PlayerSeek',
  { seconds: Schema.Number },
  (client, { seconds }) => client.controller.seekTo(seconds),
)

const Jump = operation<{ seconds: number }>(
  'PlayerJump',
  { seconds: Schema.Number },
  (client, { seconds }) =>
    seconds >= 0
      ? client.controller.jumpForward(seconds)
      : client.controller.jumpBackward(-seconds),
)

const SetVolume = operation<{ volume: number }>(
  'PlayerSetVolume',
  { volume: Schema.Number },
  (client, { volume }) => client.controller.setVolume(volume),
)

const PlayTrack = operation<{ track: typeof QueueTrack.Type }>(
  'PlayerPlayTrack',
  { track: QueueTrack },
  (client, { track }) => client.controller.playTrack(track),
)

const PlayAll = operation<{ tracks: ReadonlyArray<typeof QueueTrack.Type> }>(
  'PlayerPlayAll',
  { tracks: Schema.Array(QueueTrack) },
  (client, { tracks }) => client.controller.playAll(tracks),
)

const Enqueue = operation<{ track: typeof QueueTrack.Type }>(
  'PlayerEnqueue',
  { track: QueueTrack },
  (client, { track }) => client.controller.enqueue(track),
)

const EnqueueAll = operation<{ tracks: ReadonlyArray<typeof QueueTrack.Type> }>(
  'PlayerEnqueueAll',
  { tracks: Schema.Array(QueueTrack) },
  (client, { tracks }) => client.controller.enqueueAll(tracks),
)

const Index = operation<{ index: number }>(
  'PlayerPlayIndex',
  { index: Schema.Number },
  (client, { index }) => client.controller.playFromQueue(index),
)

const Remove = operation<{ index: number }>(
  'PlayerRemove',
  { index: Schema.Number },
  (client, { index }) => client.controller.removeFromQueue(index),
)

const Reorder = operation<{ from: number; to: number }>(
  'PlayerReorder',
  { from: Schema.Number, to: Schema.Number },
  (client, { from, to }) => client.controller.reorderQueue(from, to),
)

const queueDialogFold = {
  read: (model: Model) => Option.some(model.queueDialog),
  write: (model: Model, queueDialog: Dialog.Model): Model => ({ ...model, queueDialog }),
  toParentMessage: (message: Dialog.Message) => Message.GotQueueDialogMessage({ message }),
  foldOutMessage: Dialog.OutMessage.match<Update.Step<Model, Message>>({
    Opened: () => (model) => ({ model }),
    Closed: () => (model) => ({ model }),
  }),
}

const playerDialogFold = {
  read: (model: Model) => Option.some(model.playerDialog),
  write: (model: Model, playerDialog: Dialog.Model): Model => ({ ...model, playerDialog }),
  toParentMessage: (message: Dialog.Message) => Message.GotPlayerDialogMessage({ message }),
  foldOutMessage: Dialog.OutMessage.match<Update.Step<Model, Message>>({
    Opened: () => (model) => ({ model: { ...model, playerDrag: null, playerOffset: 0 } }),
    Closed: () => (model) => ({ model: { ...model, playerDrag: null } }),
  }),
}

const updateQueueDialog = Update.foldChild({ ...queueDialogFold, update: Dialog.update })

const updatePlayerDialog = Update.foldChild({ ...playerDialogFold, update: Dialog.update })

const openQueueDialog = Update.foldChildStep({ ...queueDialogFold, update: Dialog.open })

const closeQueueDialog = Update.foldChildStep({ ...queueDialogFold, update: Dialog.close })

const openPlayerDialog = Update.foldChildStep({ ...playerDialogFold, update: Dialog.open })

const closePlayerDialog = Update.foldChildStep({ ...playerDialogFold, update: Dialog.close })

export const closeOverlays = Update.combine([closeQueueDialog, closePlayerDialog])

const withFavorite = (
  model: Model,
  child: Update.Return<Favorite.Model, Favorite.Message>,
): Update.Return<Model, Message, PlayerClient> => ({
  model: child.model === model.favorite ? model : { ...model, favorite: child.model },
  commands: Command.mapMessages(child.commands ?? [], (message) =>
    Message.GotFavoriteMessage({ message }),
  ),
})

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, PlayerClient> =>
  Message.match(message, {
    SnapshotChanged: ({ snapshot }) =>
      withFavorite(
        {
          ...model,
          snapshot,
          hasHadTrack: model.hasHadTrack || snapshot.queue.current !== null,
        },
        Favorite.sync(model.favorite, snapshot.queue.current, model.favorite.principalId),
      ),
    TogglePlayPause: () => ({ model, commands: [Toggle()] }),
    SeekTo: ({ seconds }) => ({ model, commands: [Seek({ seconds })] }),
    Jump: ({ seconds }) => ({ model, commands: [Jump({ seconds })] }),
    SetVolume: ({ volume }) => ({ model, commands: [SetVolume({ volume })] }),
    ToggleMute: () => ({ model, commands: [ToggleMute()] }),
    PlayTrack: ({ track }) =>
      Update.combine(model, [
        openPlayerDialog,
        (model) => ({ model, commands: [PlayTrack({ track })] }),
      ]),
    PlayAll: ({ tracks }) =>
      Update.combine(model, [
        openPlayerDialog,
        (model) => ({ model, commands: [PlayAll({ tracks })] }),
      ]),
    Enqueue: ({ track }) => ({ model, commands: [Enqueue({ track })] }),
    EnqueueAll: ({ tracks }) => ({ model, commands: [EnqueueAll({ tracks })] }),
    PlayIndex: ({ index }) =>
      Update.combine(model, [
        openPlayerDialog,
        (model) => ({ model, commands: [Index({ index })] }),
      ]),
    Next: () => ({ model, commands: [Next()] }),
    Previous: () => ({ model, commands: [Previous()] }),
    Remove: ({ index }) => ({ model, commands: [Remove({ index })] }),
    Reorder: ({ from, to }) => ({ model, commands: [Reorder({ from, to })] }),
    Clear: () =>
      Update.combine(model, [closeOverlays, (model) => ({ model, commands: [Clear()] })]),
    GotQueueDialogMessage: ({ message }) => updateQueueDialog(model, message),
    GotPlayerDialogMessage: ({ message }) => updatePlayerDialog(model, message),
    ToggleQueue: () =>
      model.queueDialog.isOpen ? closeQueueDialog(model) : openQueueDialog(model),
    CloseQueue: () => closeQueueDialog(model),
    ToggleFullscreen: () =>
      model.playerDialog.isOpen ? closeOverlays(model) : openPlayerDialog(model),
    CloseFullscreen: () => closeOverlays(model),
    PlayerDragStarted: ({ pointerId, clientY }) =>
      !model.playerDialog.isOpen ||
      model.playerDialog.animation.transitionState !== 'Idle' ||
      model.playerDrag
        ? { model }
        : { model: { ...model, playerDrag: startDrag(pointerId, clientY, model.playerOffset) } },
    PlayerDragMoved: ({ pointerId, clientY }) =>
      model.playerDrag?.pointerId === pointerId
        ? { model: { ...model, playerOffset: dragOffset(model.playerDrag, clientY) } }
        : { model },
    PlayerDragReleased: ({ pointerId, clientY, viewportHeight }) => {
      if (model.playerDrag?.pointerId !== pointerId) return { model }
      const offset = dragOffset(model.playerDrag, clientY)
      const released = { ...model, playerDrag: null, playerOffset: offset }

      return shouldDismiss(offset, viewportHeight)
        ? closeOverlays(released)
        : { model: { ...released, playerOffset: 0 } }
    },
    PlayerDragCancelled: () =>
      model.playerDrag ? { model: { ...model, playerDrag: null, playerOffset: 0 } } : { model },
    DragStarted: ({ index }) => ({ model: { ...model, draggedIndex: index } }),
    DroppedAt: ({ index }) =>
      model.draggedIndex === null
        ? { model }
        : {
            model: { ...model, draggedIndex: null },
            commands: [Reorder({ from: model.draggedIndex, to: index })],
          },
    OperationCompleted: () => ({ model }),
    GotFavoriteMessage: ({ message }) =>
      withFavorite(model, Favorite.update(model.favorite, message)),
    PrincipalChanged: ({ principalId, principalKnown }) =>
      withFavorite(
        model,
        Favorite.sync(model.favorite, model.snapshot.queue.current, principalId, principalKnown),
      ),
    FavoriteChangedElsewhere: ({ audioId, active, revision }) =>
      withFavorite(model, {
        model:
          model.favorite.mutationId !== null
            ? model.favorite
            : Favorite.reconcile(model.favorite, audioId, active, revision),
      }),
  })
