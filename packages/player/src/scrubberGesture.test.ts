import { describe, expect, it } from 'vitest'

import { createScrubberGesture, type ScrubberPreview } from './scrubberGesture'

const setup = () => {
  const holds: Array<{ readonly fire: () => void; readonly delay: number; cancelled: boolean }> = []
  const previews: Array<ScrubberPreview> = []
  const commits: Array<number> = []
  let cancellations = 0
  let fineEntries = 0

  const gesture = createScrubberGesture({
    scheduleHold: (fire, delay) => {
      const hold = { fire, delay, cancelled: false }
      holds.push(hold)

      return () => {
        hold.cancelled = true
      }
    },
    onPreview: (preview) => previews.push(preview),
    onCommit: (seconds) => commits.push(seconds),
    onCancel: () => {
      cancellations += 1
    },
    onFine: () => {
      fineEntries += 1
    },
  })

  const fire = (index: number) => {
    const hold = holds[index]

    if (!hold) throw new Error(`Missing hold ${index}`)
    hold.fire()
  }

  return {
    gesture,
    holds,
    previews,
    commits,
    fire,
    cancellations: () => cancellations,
    fineEntries: () => fineEntries,
  }
}

const start = { x: 160, y: 20, width: 320, currentTime: 60.4, duration: 120 }

describe('scrubber gesture', () => {
  it('previews immediately without seeking and commits only the displayed whole second once', () => {
    const test = setup()
    test.gesture.start(start)
    expect(test.previews).toEqual([{ seconds: 60, fine: false }])
    expect(test.holds[0]?.delay).toBe(500)
    test.gesture.move(163, 20)
    expect(test.previews.at(-1)).toEqual({ seconds: 62, fine: false })
    expect(test.commits).toEqual([])
    test.gesture.release(163, 20)
    test.gesture.release(200, 20)
    expect(test.commits).toEqual([62])
    expect(test.previews.at(-1)?.seconds).toBe(test.commits[0])
    expect(test.holds.every((hold) => hold.cancelled)).toBe(true)
  })

  it('re-arms holds only beyond six points from the latest anchor in either axis', () => {
    const test = setup()
    test.gesture.start(start)
    test.gesture.move(166, 20)
    expect(test.holds).toHaveLength(1)
    test.gesture.move(166, 21)
    expect(test.holds).toHaveLength(2)
    test.fire(0)
    expect(test.fineEntries()).toBe(0)
    test.gesture.move(166, 27)
    expect(test.holds).toHaveLength(2)
    test.gesture.move(166, 28)
    expect(test.holds).toHaveLength(3)
    test.fire(1)
    expect(test.fineEntries()).toBe(0)
    test.fire(2)
    expect(test.fineEntries()).toBe(1)
  })

  it('enters fine at the latest displayed second without a jump and stays fine', () => {
    const test = setup()
    test.gesture.start(start)
    test.gesture.move(170, 20)
    test.gesture.move(173, 20)
    expect(test.previews.at(-1)).toEqual({ seconds: 68, fine: false })
    test.fire(1)
    expect(test.previews.at(-1)).toEqual({ seconds: 68, fine: true })
    test.gesture.move(177, 100)
    expect(test.previews.at(-1)).toEqual({ seconds: 69, fine: true })
    test.gesture.move(181, 200)
    expect(test.previews.at(-1)).toEqual({ seconds: 70, fine: true })
    test.fire(1)
    expect(test.fineEntries()).toBe(1)
    expect(test.holds).toHaveLength(2)
    test.gesture.release(181, 200)
    expect(test.commits).toEqual([70])
  })

  it('does not jump when released in place after a hold', () => {
    const test = setup()
    test.gesture.start(start)
    test.fire(0)
    test.gesture.release(160, 20)
    expect(test.commits).toEqual([60])
  })

  it.each(['cancel', 'release', 'dispose', 'restart'] as const)(
    'ignores stale holds after %s',
    (ending) => {
      const test = setup()
      test.gesture.start(start)

      switch (ending) {
        case 'cancel':
          test.gesture.cancel()
          test.gesture.cancel()
          break
        case 'release':
          test.gesture.release(160, 20)
          break
        case 'dispose':
          test.gesture.dispose()
          test.gesture.dispose()
          break
        case 'restart':
          test.gesture.start({ ...start, currentTime: 20, x: 90 })
          break
      }

      const before = [...test.previews]
      test.fire(0)
      expect(test.previews).toEqual(before)
      expect(test.fineEntries()).toBe(0)
      expect(test.holds[0]?.cancelled).toBe(true)
      expect(test.cancellations()).toBe(ending === 'cancel' ? 1 : 0)
      expect(test.commits).toEqual(ending === 'release' ? [60] : [])
    },
  )

  it('allows a new hold to enter fine after an obsolete gesture timer fires', () => {
    const test = setup()
    test.gesture.start(start)
    test.gesture.start({ ...start, currentTime: 20, x: 90 })
    test.fire(0)
    test.fire(1)
    expect(test.previews.at(-1)).toEqual({ seconds: 20, fine: true })
    expect(test.fineEntries()).toBe(1)
  })

  it('cleans up fine mode without callbacks and starts the next gesture coarse', () => {
    const test = setup()
    test.gesture.start(start)
    test.fire(0)
    test.gesture.dispose()
    const before = [...test.previews]
    test.fire(0)
    test.gesture.release(200, 20)
    expect(test.previews).toEqual(before)
    expect(test.commits).toEqual([])
    expect(test.cancellations()).toBe(0)
    test.gesture.start(start)
    expect(test.previews.at(-1)?.fine).toBe(false)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid width or duration %s without activating a seek',
    (invalid) => {
      for (const input of [
        { ...start, width: invalid },
        { ...start, duration: invalid },
      ]) {
        const test = setup()
        test.gesture.start(input)
        test.gesture.move(200, 20)
        test.gesture.release(200, 20)
        test.gesture.cancel()
        expect(test.previews).toEqual([])
        expect(test.holds).toEqual([])
        expect(test.commits).toEqual([])
        expect(test.cancellations()).toBe(0)
      }
    },
  )

  it('keeps whole-second previews within fractional duration at both endpoints', () => {
    const test = setup()
    test.gesture.start({ ...start, duration: 120.8 })
    test.gesture.move(-1000, 20)
    expect(test.previews.at(-1)?.seconds).toBe(0)
    test.gesture.move(1000, 20)
    expect(test.previews.at(-1)?.seconds).toBe(120)
    test.gesture.release(1000, 20)
    expect(test.commits).toEqual([120])
  })

  it('ignores invalid pointer updates without corrupting the displayed second', () => {
    const test = setup()
    test.gesture.start(start)
    test.gesture.move(Number.NaN, 20)
    test.gesture.release(Number.POSITIVE_INFINITY, 20)
    expect(test.commits).toEqual([60])
  })
})
