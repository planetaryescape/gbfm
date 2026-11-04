import { expect, test } from 'vitest'

import { recordingJourneys } from '../test/recordingJourneys'
import { playbackJourney } from './playbackJourney'

test('source loading is not a playback success until the platform reports playing', () => {
  const f = recordingJourneys()
  const journey = playbackJourney(f.sink, f.now)
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
  const journey = playbackJourney(f.sink, f.now)
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
