import type { QueueTrackType } from '@gbfm/player'

import { isPrivateMedia } from '../../media-preview/session'
import {
  initialSnapshot,
  type PlayerProviderModel,
  type PlayerProviderProps,
  type PlayerSnapshot,
} from './domain'

export const isPrivateTrack = (track: QueueTrackType) =>
  isPrivateMedia(track.url) || Boolean(track.thumbnailUrl && isPrivateMedia(track.thumbnailUrl))

export const visibleQueueIndices = (model: PlayerProviderModel, props: PlayerProviderProps) =>
  model.snapshot.queue.tracks.flatMap((track, index) => {
    if (!isPrivateTrack(track)) return [index]

    if (props.authorizationSuspended) return []
    const access = model.privateAccess

    if (!access?.principalKnown || access.principalId === null) return []

    if (props.principalKnown && access.principalId !== props.principalId) return []
    const url = isPrivateMedia(track.url) ? track.url : track.thumbnailUrl

    return url && access.authorizedUrls.includes(url) ? [index] : []
  })

export const presentedSnapshot = (
  model: PlayerProviderModel,
  props: PlayerProviderProps,
): PlayerSnapshot => {
  const indices = visibleQueueIndices(model, props)
  const snapshot = model.snapshot
  const currentIndex = indices.indexOf(snapshot.queue.currentIndex)
  const current = currentIndex < 0 ? null : snapshot.queue.current

  return {
    ...snapshot,
    queue: {
      tracks: indices.flatMap((index) => {
        const track = snapshot.queue.tracks[index]

        return track ? [track] : []
      }),
      current,
      currentIndex,
    },
    transport:
      snapshot.queue.current && !current
        ? { ...initialSnapshot.transport, isInitialized: snapshot.transport.isInitialized }
        : snapshot.transport,
  }
}
