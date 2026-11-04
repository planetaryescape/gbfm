import { describe, expect, it, vi } from 'vitest'
import type { Metric } from 'web-vitals'

import { createTelemetryBatcher, startBrowserTelemetry } from './browser'
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

  it('does not let the size-flushed batch timer flush its replacement', () => {
    const { batcher, bodies, timers } = fixture()

    for (let index = 0; index < MAX_BATCH_EVENTS; index += 1) batcher.add(event)
    expect(bodies).toHaveLength(1)
    expect(decodeBrowserTelemetryBatch(JSON.parse(bodies[0] ?? '')).events).toHaveLength(
      MAX_BATCH_EVENTS,
    )
    batcher.add(event)
    expect(timers).toHaveLength(2)
    timers[0]?.run()
    expect(bodies).toHaveLength(1)
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
    expect(bodies).toHaveLength(1)
    timers[1]?.run()
    expect(bodies).toHaveLength(2)
    expect(fetches).toEqual(bodies)
    batcher.flush()
    expect(bodies).toHaveLength(2)
  })
})

it('flushes once on disposal and ignores later vital and navigation callbacks', async () => {
  const bodies: Array<Blob> = []

  let reportVital: (metric: Metric) => void = () => {
    throw new Error('Expected vital registration')
  }

  let afterNavigation: (route: { readonly pathname: string }) => void = () => {
    throw new Error('Expected navigation subscription')
  }

  let stopped = 0
  vi.useFakeTimers()
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', new EventTarget())
  vi.stubGlobal('navigator', {
    sendBeacon: (_endpoint: string, body: Blob) => {
      bodies.push(body)

      return true
    },
  })
  vi.stubGlobal('localStorage', {
    getItem: () =>
      JSON.stringify({ id: '0123456789abcdef0123456789abcdef', createdAt: Date.now() }),
    setItem: () => undefined,
  })

  try {
    const dispose = startBrowserTelemetry({
      release: 'fixture',
      sampleRate: 1,
      navigation: {
        current: () => ({ pathname: '/' }),
        subscribe: ({ after }) => {
          afterNavigation = after

          return () => {
            stopped += 1
          }
        },
      },
      observeVitals: (report) => {
        reportVital = report
      },
    })

    const metric: Metric = {
      name: 'LCP',
      value: 125,
    }

    reportVital(metric)
    dispose()
    dispose()
    expect(stopped).toBe(1)
    expect(bodies).toHaveLength(1)
    const body = bodies[0]

    if (!body) throw new Error('Expected the disposal batch')
    expect(decodeBrowserTelemetryBatch(JSON.parse(await body.text())).events).toHaveLength(2)
    reportVital(metric)
    await vi.runAllTimersAsync()
    expect(bodies).toHaveLength(1)
    afterNavigation({ pathname: '/mixes' })
    await vi.runAllTimersAsync()
    expect(bodies).toHaveLength(1)
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
