import { expect, test } from 'vitest'

import { presentToastNotice } from './toastPresentation'

const fixture = () => {
  let hide: (() => void) | null = null
  const frames: Array<{ target: number; duration: number }> = []
  let complete: ((finished: boolean) => void) | undefined
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
          complete = callback
        },
      },
      (message) => announced.push(message),
      (notice) => dismissed.push(notice),
      (delay, callback) => {
        expect(delay).toBe(2400)
        hide = callback

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
    finish: (finished: boolean) => complete?.(finished),
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
  f.finish(false)
  expect(f.dismissed).toEqual([])
  f.finish(true)
  expect(f.dismissed[0]).toBe(notice)
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
  f.finish(true)
  expect(f.dismissed).toEqual([second])
  expect(f.dismissed[0]).toBe(second)
  expect(f.stopped()).toBe(2)
  expect(f.reset()).toBe(2)
})

test('unmount cancels a waiting timer', () => {
  const f = fixture()
  const release = f.start({ message: 'Added to queue' })
  release()
  f.expire()
  expect(f.frames).toHaveLength(1)
  expect(f.dismissed).toEqual([])
})

test('characterizes cleanup during fade-out: the native completion remains owned by Animated', () => {
  const f = fixture()
  const notice = { message: 'Added to queue' }
  const release = f.start(notice)
  f.expire()
  release()
  f.finish(true)
  expect(f.dismissed[0]).toBe(notice)
})
