import { describe, expect, test } from 'vitest'

import type { QueueTrackType } from './persistedQueue'
import { initialQueueState, mergeHydratedQueue, QueueAction, reduceQueue } from './queueState'

const track = (id: string): QueueTrackType => ({
  id,
  title: id,
  slug: id,
  url: `https://example.com/${id}.mp3`,
  thumbnailUrl: null,
  type: 'mix',
})

describe('audio queue state', () => {
  test('builds an unselected queue, replaces it for playback, edits it without interruption, and clears it', () => {
    let state = reduceQueue(
      initialQueueState,
      QueueAction.enqueueAll({ tracks: [track('old'), track('unused')] }),
    )

    expect(state).toEqual({ tracks: [track('old'), track('unused')], currentIndex: -1 })

    state = reduceQueue(state, QueueAction.playIndex({ index: 1 }))
    expect(state.currentIndex).toBe(1)
    state = reduceQueue(
      state,
      QueueAction.playAll({ tracks: [track('one'), track('one'), track('two')] }),
    )
    expect(state).toEqual({ tracks: [track('one'), track('two')], currentIndex: 0 })

    state = reduceQueue(state, QueueAction.enqueue({ track: track('next') }))
    expect(state).toEqual({
      tracks: [track('one'), track('two'), track('next')],
      currentIndex: 0,
    })
    state = reduceQueue(state, QueueAction.enqueue({ track: track('before'), at: 0 }))
    expect(state).toEqual({
      tracks: [track('before'), track('one'), track('two'), track('next')],
      currentIndex: 1,
    })

    state = reduceQueue(state, QueueAction.remove({ index: 1 }))
    expect(state).toEqual({
      tracks: [track('before'), track('two'), track('next')],
      currentIndex: 1,
    })
    expect(reduceQueue(state, QueueAction.clear())).toEqual({ tracks: [], currentIndex: -1 })
  })

  test('hydration replays early actions over the stored queue', () => {
    const stored = { tracks: [track('stored')], currentIndex: 0 }

    const hydrated = mergeHydratedQueue(stored, [
      QueueAction.enqueue({ track: track('early') }),
      QueueAction.playIndex({ index: 1 }),
    ])

    expect(hydrated.tracks.map(({ id }) => id)).toEqual(['stored', 'early'])
    expect(hydrated.currentIndex).toBe(1)
  })

  test('replays pending actions over an empty fallback when hydration fails', () => {
    const hydrated = mergeHydratedQueue(initialQueueState, [
      QueueAction.enqueue({ track: track('early') }),
    ])

    expect(hydrated).toEqual({ tracks: [track('early')], currentIndex: -1 })
  })
})
