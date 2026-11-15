export { scrubberCurve, scrubberProgress, scrubberTime } from './scrubber'

export {
  AudioStorageError,
  hasCompleteCreators,
  PersistedQueue,
  parsePersistedQueue,
  QueueTrack,
  type PersistedQueueType,
  type QueueTrackType,
} from './persistedQueue'

export { initialQueueState, mergeHydratedQueue, reduceQueue, type QueueAction } from './queueState'

export {
  createAudioStorage,
  createWebAudioStorageAdapter,
  DEDUP_WINDOW_MS,
  type AudioStorageAdapter,
  type PositionRecordType,
  type VolumeRecordType,
} from './audioStorage'

export { createPlayDelivery } from './playDelivery'

export { PlayerPreferences, defaultPlayerPreferences } from './preferences'

export {
  PlayReporter,
  PlayReporterNoop,
  makePlayReporterLayer,
  type PlayReporterContract,
} from './playReporter'

export {
  AudioEngine,
  PlaybackRejected,
  type AudioEngineContract,
  type EngineStatus,
  type NowPlayingMetadata,
  type PlaybackCommandHandlers,
} from './engine'

export {
  clearPosition,
  isWithinDedupWindow,
  layerFromAdapter,
  loadPosition,
  loadQueue,
  loadVolume,
  PlayerStorage,
  PlayerStorageInMemory,
  PlayerStorageTest,
  recordPlay,
  savePosition,
  saveQueue,
  saveVolume,
  type PlayerStorageContract,
  type PositionRecord,
} from './playerStorage'

export {
  makeAudioPlayback,
  selectQueueView,
  type AudioPlaybackCallbacks,
  type AudioPlaybackReporter,
  type AudioPlaybackController,
  type PlaybackSnapshot,
  type PlaybackTransportSnapshot,
  type QueueView,
} from './audioPlayback'

export { makePlayerCore, type PlayerCoreCallbacks, type PlayerCoreController } from './playerCore'

export {
  makeQueueAtom,
  type InternalQueueAction,
  type QueueAtomHandle,
  type QueueAtomStorage,
} from './queueAtom'
