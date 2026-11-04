import { expect, test } from 'vitest'

import { recordingJourneys } from '../test/recordingJourneys'
import { startJourney } from './journey'

test('a journey records one logical outcome and its duration, not every completion callback', () => {
  const f = recordingJourneys()
  const finish = startJourney(f.sink, 'reader.open', f.now)
  f.advance(175)
  finish('succeeded')
  f.advance(25)
  finish('canceled')
  expect(f.records).toEqual([{ name: 'reader.open', outcome: 'succeeded', durationMs: 175 }])
})

test('telemetry failures do not escape into application behavior', () => {
  const fail = () => {
    throw new Error('export unavailable')
  }

  expect(() => startJourney({ start: fail }, 'reader.open')('succeeded')).not.toThrow()
  expect(() => startJourney({ start: () => fail }, 'reader.open')('failed')).not.toThrow()
})
