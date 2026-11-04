import { playbackJourney } from '@gbfm/observability/playback'
import { expect, test } from 'vitest'

import { recordingJourneys } from '../test/recordingJourneys'

test('source loading is not a playback success until the platform reports playing', () => {
  const f = recordingJourneys()
  const journey = playbackJourney(f.observer)
  journey.replace()
  journey.status({ playing: false, error: null })
  expect(f.records).toEqual([])
  f.advance(340)
  journey.status({ playing: true, error: null })
  journey.status({ playing: true, error: null })
  journey.cancel()
  expect(f.records).toEqual([{ name: 'playback.start', outcome: 'succeeded', durationMs: 340 }])
})

test('replacement, platform error, and disposal settle attempts without reporting raw errors', () => {
  const f = recordingJourneys()
  const journey = playbackJourney(f.observer)
  journey.replace()
  f.advance(10)
  journey.replace()
  f.advance(20)
  journey.status({ playing: false, error: 'private URL and credential' })
  journey.replace()
  f.advance(30)
  journey.cancel()
  journey.cancel()
  expect(f.records).toEqual([
    { name: 'playback.start', outcome: 'canceled', durationMs: 10 },
    { name: 'playback.start', outcome: 'failed', durationMs: 20 },
    { name: 'playback.start', outcome: 'canceled', durationMs: 30 },
  ])
})

test('paused hydration waits for explicit play, and resume is not a second initial start', () => {
  const f = recordingJourneys()
  const journey = playbackJourney(f.observer)
  journey.replace('paused')
  expect(f.starts).toEqual([])
  f.advance(1000)
  journey.play()
  f.advance(25)
  journey.status({ playing: true, error: null })
  journey.cancel()
  journey.play()
  journey.status({ playing: true, error: null })
  expect(f.records).toEqual([{ name: 'playback.start', outcome: 'succeeded', durationMs: 25 }])
})
