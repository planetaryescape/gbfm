import { expect, test } from 'vitest'

import { recordingJourneys } from '../test/recordingJourneys'
import { readerJourney } from './readerJourney'

test('reader outcomes follow committed state, ignore stale results, and distinguish empty from failure', () => {
  const f = recordingJourneys()
  const journey = readerJourney(f.sink, f.now)
  const cancelFirst = journey.start(1)
  f.advance(25)
  journey.start(2)
  cancelFirst()
  journey.committed({ request: 1, status: 'error', hasContent: false })
  journey.committed({ request: 2, status: 'loading', hasContent: false })
  f.advance(75)
  journey.committed({ request: 2, status: 'empty', hasContent: false })
  journey.start(3)
  f.advance(50)
  journey.committed({ request: 3, status: 'error', hasContent: false })
  expect(f.records).toEqual([
    { name: 'reader.open', outcome: 'canceled', durationMs: 25 },
    { name: 'reader.open', outcome: 'empty', durationMs: 75 },
    { name: 'reader.open', outcome: 'failed', durationMs: 50 },
  ])
})

test('a committed cached post succeeds once and later network failure or blur cannot rewrite it', () => {
  const f = recordingJourneys()
  const journey = readerJourney(f.sink, f.now)
  const cancel = journey.start(1)
  journey.committed({ request: 1, status: 'loading', hasContent: true })
  expect(f.records).toEqual([])
  f.advance(16)
  journey.committed({ request: 1, status: 'ready', hasContent: true })
  journey.committed({ request: 1, status: 'error', hasContent: true })
  cancel()
  expect(f.records).toEqual([{ name: 'reader.open', outcome: 'succeeded', durationMs: 16 }])
})
