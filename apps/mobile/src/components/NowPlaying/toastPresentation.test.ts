import { expect, test } from 'vitest'

import { presentToastNotice } from './toastPresentation'

const fixture = () => {
  let hide: (() => void) | null = null
  const frames: Array<{ target: number; duration: number }> = []
  const completions = new Map<number, (finished: boolean) => void>()
  const scheduled: Array<() => void> = []
  const announced: Array<string> = []
  const dismissed: Array<{ message: string }> = []
  let stopped = 0
  let reset = 0

  const start = (notice: { message: string }) =>
    presentToastNotice(
      notice,
      {
        stop: () => {
          stopped += 1
        },
        reset: () => {
          reset += 1
        },
        animate: (target, duration, callback) => {
          frames.push({ target, duration })

          if (callback) completions.set(frames.length - 1, callback)
        },
      },
      (message) => announced.push(message),
      (notice) => dismissed.push(notice),
      (delay, callback) => {
        expect(delay).toBe(2400)
        hide = callback
        scheduled.push(callback)

        return () => {
          hide = null
        }
      },
    )

  return {
    start,
    announced,
    dismissed,
    frames,
    expire: () => hide?.(),
    deliverTimer: (index: number) => scheduled[index]?.(),
    finish: (frame: number, finished: boolean) => {
      const complete = completions.get(frame)

      if (!complete) throw new Error('expected a pending animation completion')
      completions.delete(frame)
      complete(finished)
    },
    stopped: () => stopped,
    reset: () => reset,
  }
}

test('expiry dismisses the exact notice only after a finished fade-out', () => {
  const f = fixture()
  const notice = { message: 'Added to queue' }
  f.start(notice)
  expect(f.announced).toEqual(['Added to queue'])
  expect(f.frames).toEqual([{ target: 1, duration: 180 }])
  expect(f.stopped()).toBe(1)
  expect(f.reset()).toBe(1)
  f.expire()
  expect(f.frames).toEqual([
    { target: 1, duration: 180 },
    { target: 0, duration: 220 },
  ])
  f.finish(1, true)
  expect(f.dismissed[0]).toBe(notice)
})

test('an interrupted fade-out does not dismiss the notice', () => {
  const f = fixture()
  f.start({ message: 'Added to queue' })
  f.expire()
  f.finish(1, false)
  expect(f.dismissed).toEqual([])
})

test('replacement cancels the old timer and resets animation even for equal messages', () => {
  const f = fixture()
  const first = { message: 'Playing track' }
  const second = { message: 'Playing track' }
  const release = f.start(first)
  release()
  f.expire()
  expect(f.frames).toHaveLength(1)
  f.start(second)
  f.expire()
  f.finish(2, true)
  expect(f.dismissed).toEqual([second])
  expect(f.dismissed[0]).toBe(second)
  expect(f.stopped()).toBe(3)
  expect(f.reset()).toBe(2)
})

test.each([false, true])(
  'a released completion with finished=%s cannot dismiss after replacement',
  (finished) => {
    const f = fixture()
    const first = { message: 'Playing track' }
    const second = { message: 'Playing track' }
    const release = f.start(first)
    f.expire()
    release()
    f.start(second)
    f.expire()
    expect(f.frames).toEqual([
      { target: 1, duration: 180 },
      { target: 0, duration: 220 },
      { target: 1, duration: 180 },
      { target: 0, duration: 220 },
    ])
    f.finish(1, finished)
    expect(f.dismissed).toEqual([])
    expect(f.dismissed).not.toContain(second)
    f.finish(3, true)
    expect(f.dismissed).toEqual([second])
    expect(f.dismissed.at(-1)).toBe(second)
  },
)

test('unmount cancels a waiting timer', () => {
  const f = fixture()
  const release = f.start({ message: 'Added to queue' })
  release()
  f.expire()
  expect(f.frames).toHaveLength(1)
  expect(f.dismissed).toEqual([])
})

test('release during fade-out stops animation and invalidates native completion', () => {
  const f = fixture()
  const notice = { message: 'Added to queue' }
  const release = f.start(notice)
  f.expire()
  release()
  release()
  f.finish(1, true)
  expect(f.dismissed).toEqual([])
  expect(f.stopped()).toBe(2)
})

test('an already queued timer cannot animate after release or replacement', () => {
  const f = fixture()
  const release = f.start({ message: 'First notice' })
  release()
  f.start({ message: 'Replacement notice' })
  f.deliverTimer(0)
  expect(f.frames).toEqual([
    { target: 1, duration: 180 },
    { target: 1, duration: 180 },
  ])
  expect(f.dismissed).toEqual([])
})
