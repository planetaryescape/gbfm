import { UiSchema } from '@effect/ui'
import { QueueTrack } from '@gbfm/player'
import { Schema } from 'effect'

export const PlayerSnapshot = Schema.Struct({
  queue: Schema.Struct({
    tracks: Schema.Array(QueueTrack),
    currentIndex: Schema.Number,
    current: Schema.NullOr(QueueTrack),
  }),
  transport: Schema.Struct({
    isInitialized: Schema.Boolean,
    isLoaded: Schema.Boolean,
    isPlaying: Schema.Boolean,
    isBuffering: Schema.Boolean,
    currentTime: Schema.Number,
    duration: Schema.Number,
  }),
  volume: Schema.Struct({ volume: Schema.Number, isMuted: Schema.Boolean }),
})

export type PlayerSnapshot = typeof PlayerSnapshot.Type

export const initialSnapshot: PlayerSnapshot = {
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

export const SeekPreview = Schema.Struct({
  seconds: Schema.Number,
  fine: Schema.Boolean,
  referenceSeconds: Schema.Number,
  pointerRatio: Schema.Number,
})

export type SeekPreview = typeof SeekPreview.Type

export const PlayerProviderProps = Schema.Struct({
  principalId: Schema.NullOr(Schema.String),
  principalKnown: Schema.Boolean,
  returnTo: Schema.String,
  authorizationSuspended: Schema.optional(Schema.Boolean),
})

export type PlayerProviderProps = typeof PlayerProviderProps.Type

export const PrivatePlaybackSnapshot = Schema.Struct({
  principalId: Schema.NullOr(Schema.String),
  principalKnown: Schema.Boolean,
  revision: Schema.Number,
  authorizedUrls: Schema.Array(Schema.String),
})

export const PlayerProviderModel = Schema.Struct({
  snapshot: PlayerSnapshot,
  privateAccess: Schema.NullOr(PrivatePlaybackSnapshot),
  queueOpen: Schema.Boolean,
  fullscreenOpen: Schema.Boolean,
  fullscreenSettled: Schema.Boolean,
  playerDrag: Schema.NullOr(Schema.Struct({ pointerId: Schema.Number, startY: Schema.Number })),
  playerOffset: Schema.Number,
  seekPreview: Schema.NullOr(SeekPreview),
  seekSequence: Schema.Number,
  pendingSeek: Schema.NullOr(Schema.Struct({ sequence: Schema.Number, seconds: Schema.Number })),
  hasHadTrack: Schema.Boolean,
})

export type PlayerProviderModel = typeof PlayerProviderModel.Type

export const initialModel: PlayerProviderModel = {
  snapshot: initialSnapshot,
  privateAccess: null,
  queueOpen: false,
  fullscreenOpen: false,
  fullscreenSettled: true,
  playerDrag: null,
  playerOffset: 0,
  seekPreview: null,
  seekSequence: 0,
  pendingSeek: null,
  hasHadTrack: false,
}

export const PlayerProviderMessage = UiSchema.TaggedEnum({
  ChangedPrincipal: {},
  ChangedPrivateAccess: { access: PrivatePlaybackSnapshot },
  ChangedSnapshot: { snapshot: PlayerSnapshot },
  RequestedPlayTrack: { track: QueueTrack },
  RequestedPlayAll: { tracks: Schema.Array(QueueTrack) },
  RequestedEnqueue: { track: QueueTrack },
  RequestedEnqueueAll: { tracks: Schema.Array(QueueTrack) },
  RequestedPlayIndex: { index: Schema.Number },
  RequestedTogglePlayPause: {},
  RequestedNext: {},
  RequestedPrevious: {},
  RequestedSeek: { seconds: Schema.Number },
  CompletedSeek: { sequence: Schema.Number, trackId: Schema.String },
  RequestedJump: { seconds: Schema.Number },
  RequestedVolume: { volume: Schema.Number },
  RequestedToggleMute: {},
  RequestedRemove: { index: Schema.Number },
  RequestedReorder: { from: Schema.Number, to: Schema.Number },
  RequestedClear: {},
  RequestedToggleQueue: {},
  RequestedCloseQueue: {},
  RequestedToggleFullscreen: {},
  RequestedCloseFullscreen: {},
  RequestedCloseOverlays: {},
  SettledFullscreen: { open: Schema.Boolean },
  StartedPlayerDrag: { pointerId: Schema.Number, clientY: Schema.Number },
  MovedPlayerDrag: { pointerId: Schema.Number, clientY: Schema.Number },
  ReleasedPlayerDrag: {
    pointerId: Schema.Number,
    clientY: Schema.Number,
    viewportHeight: Schema.Number,
  },
  CancelledPlayerDrag: {},
  PreviewedSeek: {
    trackId: Schema.String,
    seconds: Schema.Number,
    fine: Schema.Boolean,
    referenceSeconds: Schema.Number,
    pointerRatio: Schema.Number,
  },
  CommittedSeek: { trackId: Schema.String, seconds: Schema.Number },
  CancelledSeek: { trackId: Schema.String },
})

export type PlayerProviderMessage = typeof PlayerProviderMessage.Type

export const PlayerProviderEvents = Schema.Never

export const PlayerControlMessage = Schema.Union([
  PlayerProviderMessage.cases.RequestedPlayTrack,
  PlayerProviderMessage.cases.RequestedPlayAll,
  PlayerProviderMessage.cases.RequestedEnqueue,
  PlayerProviderMessage.cases.RequestedEnqueueAll,
  PlayerProviderMessage.cases.RequestedPlayIndex,
  PlayerProviderMessage.cases.RequestedTogglePlayPause,
  PlayerProviderMessage.cases.RequestedNext,
  PlayerProviderMessage.cases.RequestedPrevious,
  PlayerProviderMessage.cases.RequestedSeek,
  PlayerProviderMessage.cases.RequestedJump,
  PlayerProviderMessage.cases.RequestedVolume,
  PlayerProviderMessage.cases.RequestedToggleMute,
  PlayerProviderMessage.cases.RequestedRemove,
  PlayerProviderMessage.cases.RequestedReorder,
  PlayerProviderMessage.cases.RequestedClear,
  PlayerProviderMessage.cases.RequestedToggleQueue,
  PlayerProviderMessage.cases.RequestedCloseQueue,
  PlayerProviderMessage.cases.RequestedToggleFullscreen,
  PlayerProviderMessage.cases.RequestedCloseFullscreen,
  PlayerProviderMessage.cases.RequestedCloseOverlays,
  PlayerProviderMessage.cases.SettledFullscreen,
  PlayerProviderMessage.cases.StartedPlayerDrag,
  PlayerProviderMessage.cases.MovedPlayerDrag,
  PlayerProviderMessage.cases.ReleasedPlayerDrag,
  PlayerProviderMessage.cases.CancelledPlayerDrag,
  PlayerProviderMessage.cases.PreviewedSeek,
  PlayerProviderMessage.cases.CommittedSeek,
  PlayerProviderMessage.cases.CancelledSeek,
])

export type PlayerControlMessage = typeof PlayerControlMessage.Type

export const PlayerOperation = UiSchema.TaggedEnum({
  ConfirmPrincipal: {
    principalId: Schema.NullOr(Schema.String),
    principalKnown: Schema.Boolean,
    authorizationSuspended: Schema.optional(Schema.Boolean),
  },
  PlayTrack: { track: QueueTrack },
  PlayAll: { tracks: Schema.Array(QueueTrack) },
  Enqueue: { track: QueueTrack },
  EnqueueAll: { tracks: Schema.Array(QueueTrack) },
  PlayIndex: { index: Schema.Number },
  TogglePlayPause: {},
  Next: {},
  Previous: {},
  Seek: { seconds: Schema.Number },
  Jump: { seconds: Schema.Number },
  Volume: { volume: Schema.Number },
  ToggleMute: {},
  Remove: { index: Schema.Number },
  Reorder: { from: Schema.Number, to: Schema.Number },
  Clear: {},
})

export const closeOverlays = (model: PlayerProviderModel): PlayerProviderModel => ({
  ...model,
  queueOpen: false,
  fullscreenOpen: false,
  fullscreenSettled: !model.fullscreenOpen && model.fullscreenSettled,
  playerDrag: null,
  playerOffset: 0,
  seekPreview: null,
})

export const safeReturnTo = (path: string) => {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/'
  const url = new URL(path, 'https://gbfm.invalid')

  return url.origin === 'https://gbfm.invalid' ? `${url.pathname}${url.search}${url.hash}` : '/'
}
