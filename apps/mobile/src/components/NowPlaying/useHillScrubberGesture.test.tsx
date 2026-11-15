import { act, createElement, useLayoutEffect } from 'react'
import { createRoot } from 'test-renderer'
import { afterEach, expect, test, vi } from 'vitest'

import { useHillScrubberGesture } from './useHillScrubberGesture'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const roots = new Set<ReturnType<typeof createRoot>>()

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount()
    roots.clear()
  })
  vi.useRealTimers()
})

const pointer = (pageX: number, locationX = 0, pageY = 100) => ({
  nativeEvent: { pageX, locationX, pageY },
})

const mount = async () => {
  vi.useFakeTimers()
  let current: ReturnType<typeof useHillScrubberGesture> | undefined
  const seeks: Array<{ seconds: number; completion: PromiseWithResolvers<void> }> = []
  const presses: Array<number> = []
  let haptics = 0
  let time = 25
  let duration = 100

  function Probe() {
    const gesture = useHillScrubberGesture({
      currentTime: time,
      duration,
      onSeek: (seconds) => {
        const completion = Promise.withResolvers<void>()
        seeks.push({ seconds, completion })

        return completion.promise
      },
      onPressChange: (pressed) => presses.push(pressed),
      onHaptic: () => {
        haptics++
      },
    })

    useLayoutEffect(() => {
      current = gesture
    })

    return null
  }

  const root = createRoot()
  roots.add(root)

  const render = async (nextTime = time, nextDuration = duration) => {
    time = nextTime
    duration = nextDuration
    await act(async () => root.render(createElement(Probe)))
  }

  await render()

  const gesture = () => {
    if (!current) throw new Error('Scrubber not mounted')

    return current
  }

  await act(async () => gesture().onLayout({ nativeEvent: { layout: { width: 200 } } }))

  return {
    gesture,
    seeks,
    presses,
    get haptics() {
      return haptics
    },
    render,
    unmount: async () => {
      roots.delete(root)
      await act(async () => root.unmount())
    },
  }
}

test('maps page coordinates from the initial origin and retains a pending committed second', async () => {
  const f = await mount()
  await act(async () => f.gesture().start(pointer(150, 50)))
  expect(f.gesture().feedback).toMatchObject({
    x: 50,
    referenceSeconds: 25,
    preview: { seconds: 25 },
  })
  await act(async () => f.gesture().move(pointer(190, 2)))
  expect(f.gesture().feedback).toMatchObject({ x: 90, preview: { seconds: 56, fine: false } })
  await act(async () => vi.advanceTimersByTime(500))
  expect(f.gesture().feedback?.preview.fine).toBe(true)
  expect(f.haptics).toBe(2)
  await act(async () => f.gesture().move(pointer(210)))
  expect(f.gesture().position).toBe(61)
  await act(async () => f.gesture().release(pointer(210)))
  expect(f.seeks.map(({ seconds }) => seconds)).toEqual([61])
  expect(f.gesture().feedback).toBeNull()
  expect(f.gesture().position).toBe(61)
  expect(f.presses).toEqual([1, 0])
  await f.render(26)
  expect(f.gesture().position).toBe(61)
  await act(async () => {
    await f.render(61)
    f.seeks[0]?.completion.resolve()
  })
  expect(f.gesture().position).toBe(61)
  await f.render(62)
  expect(f.gesture().position).toBe(62)
})

test('cancellation and duration changes discard preview, hold timers and pending display', async () => {
  const f = await mount()
  await act(async () => f.gesture().start(pointer(150, 50)))
  await act(async () => f.gesture().cancel())
  expect(f.gesture().feedback).toBeNull()
  expect(f.gesture().position).toBe(25)
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => vi.advanceTimersByTime(500))
  expect(f.haptics).toBe(1)
  await act(async () => f.gesture().release(pointer(190)))
  expect(f.seeks).toEqual([])
  await act(async () => f.gesture().start(pointer(150, 50)))
  await f.render(25, 200)
  expect(f.gesture().feedback).toBeNull()
  await act(async () => vi.advanceTimersByTime(500))
  await act(async () => f.gesture().release(pointer(190)))
  expect(f.seeks).toEqual([])
  expect(f.presses).toEqual([1, 0, 1, 0])
  await act(async () => {
    f.gesture().start(pointer(150, 50))
    f.gesture().release(pointer(170))
  })
  expect(f.gesture().position).not.toBe(25)
  await act(async () => f.gesture().cancel())
  expect(f.gesture().position).toBe(25)
  await act(async () => f.seeks[0]?.completion.resolve())
  expect(f.gesture().position).toBe(25)
})

test('failed and superseded commits settle without hiding later playback', async () => {
  const f = await mount()
  await act(async () => {
    f.gesture().start(pointer(150, 50))
    f.gesture().release(pointer(190))
  })
  expect(f.gesture().position).toBe(56)
  await act(async () => {
    f.gesture().start(pointer(190, 90))
    f.gesture().release(pointer(210))
  })
  expect(f.gesture().position).toBe(71)
  await act(async () => f.seeks[0]?.completion.resolve())
  expect(f.gesture().position).toBe(71)
  await act(async () => f.seeks[1]?.completion.reject(new Error('seek failed')))
  expect(f.gesture().position).toBe(25)
  await f.render(26)
  expect(f.gesture().position).toBe(26)
})

test('unmount disposes hold feedback and rejects retained responder callbacks', async () => {
  const f = await mount()
  await act(async () => f.gesture().start(pointer(150, 50)))
  const stale = f.gesture()
  await f.unmount()
  await act(async () => {
    vi.advanceTimersByTime(1000)
    stale.move(pointer(190))
    stale.release(pointer(190))
    stale.start(pointer(150, 50))
  })
  expect(f.seeks).toEqual([])
  expect(f.haptics).toBe(1)
  expect(f.presses).toEqual([1, 0])
  expect(vi.getTimerCount()).toBe(0)
})

test('a track remount does not inherit an old pending commit or its completion', async () => {
  const f = await mount()
  await act(async () => {
    f.gesture().start(pointer(150, 50))
    f.gesture().release(pointer(190))
  })
  expect(f.gesture().position).toBe(56)
  await f.unmount()
  const replacement = await mount()
  await replacement.render(75)
  await act(async () => f.seeks[0]?.completion.resolve())
  expect(replacement.gesture().position).toBe(75)
  expect(replacement.gesture().feedback).toBeNull()
  expect(replacement.seeks).toEqual([])
})
