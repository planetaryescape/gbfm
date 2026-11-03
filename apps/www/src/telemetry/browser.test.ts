import { describe, expect, it } from 'vitest'

import { createTelemetryBatcher } from './browser'
import {
  decodeBrowserTelemetryBatch,
  MAX_BATCH_EVENTS,
  type BrowserTelemetryEvent,
} from './contract'

const event: BrowserTelemetryEvent = { kind: 'player', name: 'play', route: '/' }

const fixture = (beaconAccepted = true) => {
  const bodies: Array<string> = []
  const fetches: Array<string> = []
  const timers: Array<{ readonly run: () => void; readonly delay: number }> = []

  const batcher = createTelemetryBatcher({
    session: '0123456789abcdef0123456789abcdef',
    release: 'fixture',
    now: () => 123,
    schedule: (run, delay) => {
      timers.push({ run, delay })
    },
    transport: {
      beacon: (body) => {
        bodies.push(body)

        return beaconAccepted
      },
      fetch: async (body) => {
        fetches.push(body)
        throw new Error('fixture offline')
      },
    },
  })

  return { batcher, bodies, fetches, timers }
}

describe('telemetry batch scheduling', () => {
  it('schedules once per batch and drains on the timer', () => {
    const { batcher, bodies, timers, fetches } = fixture()
    batcher.flush()
    batcher.add(event)
    batcher.add(event)
    expect(timers).toHaveLength(1)
    expect(timers[0]?.delay).toBe(5_000)
    timers[0]?.run()
    expect(decodeBrowserTelemetryBatch(JSON.parse(bodies[0] ?? '')).events).toEqual([event, event])
    expect(fetches).toEqual([])
    batcher.flush()
    expect(bodies).toHaveLength(1)
    batcher.add(event)
    expect(timers).toHaveLength(2)
  })

  it('flushes at the size limit and retains the existing old-timer behavior', () => {
    const { batcher, bodies, timers } = fixture()

    for (let index = 0; index < MAX_BATCH_EVENTS; index += 1) batcher.add(event)
    expect(bodies).toHaveLength(1)
    expect(decodeBrowserTelemetryBatch(JSON.parse(bodies[0] ?? '')).events).toHaveLength(
      MAX_BATCH_EVENTS,
    )
    batcher.add(event)
    expect(timers).toHaveLength(2)
    timers[0]?.run()
    expect(bodies).toHaveLength(2)
    timers[1]?.run()
    expect(bodies).toHaveLength(2)
  })

  it('drains lifecycle flushes once, accepts later events and drops failed fallback sends', async () => {
    const { batcher, bodies, timers, fetches } = fixture(false)
    batcher.add(event)
    batcher.flush()
    batcher.flush()
    expect(fetches).toEqual(bodies)
    batcher.add(event)
    timers[0]?.run()
    await Promise.resolve()
    expect(bodies).toHaveLength(2)
    expect(fetches).toEqual(bodies)
    batcher.flush()
    expect(bodies).toHaveLength(2)
  })
})
