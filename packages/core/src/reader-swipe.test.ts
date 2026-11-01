import { expect, test } from 'vitest'

import {
  beginReaderSwipe,
  finishReaderSwipe,
  moveReaderSwipe,
  readerSwipeDistance,
  readerSwipeOffset,
  type SwipePoint,
} from './reader-swipe'

const start: SwipePoint = { x: 190, y: 200, time: 0, pointers: 1 }

test('left opens older and right opens newer with a deliberate horizontal swipe', () => {
  const swipe = beginReaderSwipe(start, 390)

  expect(finishReaderSwipe(swipe, { ...start, x: 90, time: 250 })).toBe('older')
  expect(finishReaderSwipe(swipe, { ...start, x: 300, time: 250 })).toBe('newer')
})

test('distance scales with the viewport and slow releases snap back below the threshold', () => {
  expect(readerSwipeDistance(390)).toBe(97.5)
  expect(readerSwipeDistance(200)).toBe(80)
  expect(readerSwipeDistance(1280)).toBe(160)
  const swipe = beginReaderSwipe(start, 390)

  expect(finishReaderSwipe(swipe, { ...start, x: 110, time: 400 })).toBeNull()
  expect(finishReaderSwipe(swipe, { ...start, x: 90, time: 400 })).toBe('older')
})

test('recent velocity accepts deliberate short flicks, but never tiny flicks', () => {
  const swipe = beginReaderSwipe(start, 390)

  expect(finishReaderSwipe(swipe, { ...start, x: 150, time: 50 })).toBe('older')
  expect(finishReaderSwipe(swipe, { ...start, x: 230, time: 50 })).toBe('newer')
  expect(finishReaderSwipe(swipe, { ...start, x: 170, time: 10 })).toBeNull()
  expect(finishReaderSwipe(swipe, { ...start, x: 150, time: 300 })).toBeNull()
})

test('holding after a flick loses momentum; only recent motion counts', () => {
  const swipe = moveReaderSwipe(beginReaderSwipe(start, 390), { ...start, x: 150, time: 50 })

  expect(finishReaderSwipe(swipe, { ...start, x: 150, time: 400 })).toBeNull()
})

test('native recognizer velocity takes precedence over coalesced delivery timing', () => {
  const swipe = beginReaderSwipe(start, 390)
  const end = { ...start, x: 150, time: 1 }
  expect(finishReaderSwipe(swipe, end, 0)).toBeNull()
  expect(finishReaderSwipe(swipe, end, -0.8)).toBe('older')
  expect(finishReaderSwipe(swipe, end, NaN)).toBeNull()
})

test('a deliberate slow drag can commit, but a reversal pulls it back', () => {
  let swipe = moveReaderSwipe(beginReaderSwipe(start, 390), { ...start, x: 170, time: 100 })
  swipe = moveReaderSwipe(swipe, { ...start, x: 40, time: 900 })
  expect(finishReaderSwipe(swipe, { ...start, x: 40, time: 1100 })).toBe('older')
  expect(finishReaderSwipe(swipe, { ...start, x: 80, time: 950 })).toBeNull()
})

test('drag feedback follows horizontal motion and resists unavailable directions', () => {
  const swipe = moveReaderSwipe(beginReaderSwipe(start, 390), { ...start, x: 120, time: 100 })

  expect(readerSwipeOffset(swipe)).toBe(-70)
  expect(readerSwipeOffset(swipe, false)).toBeCloseTo(-12.6)
  expect(readerSwipeOffset(beginReaderSwipe(start, 390))).toBe(0)
  expect(readerSwipeOffset(moveReaderSwipe(swipe, { ...start, y: 260, time: 200 }))).toBe(0)
})

test.each([0, 16, 32, 358, 374, 390])('preserves OS edge navigation at x=%s', (x) => {
  expect(beginReaderSwipe({ ...start, x }, 390)).toBeNull()
})

test('taps, short drags, long presses, vertical scroll and diagonal gestures do not navigate', () => {
  const swipe = beginReaderSwipe(start, 390)

  for (const point of [
    { ...start, time: 100 },
    { ...start, x: 150, time: 100 },
    { ...start, x: 80, time: 900 },
    { ...start, y: 400, time: 200 },
    { ...start, x: 100, y: 270, time: 200 },
    { ...start, x: 100, time: -1 },
  ])
    expect(finishReaderSwipe(swipe, point)).toBeNull()
})

test('a gesture that starts as a vertical scroll never turns into navigation', () => {
  const swipe = moveReaderSwipe(beginReaderSwipe(start, 390), { ...start, y: 220, time: 50 })

  expect(finishReaderSwipe(swipe, { ...start, x: 80, time: 200 })).toBeNull()
})

test('a large vertical excursion stays rejected even if the finger returns to the original row', () => {
  let swipe = moveReaderSwipe(beginReaderSwipe(start, 390), { ...start, x: 160, time: 50 })
  swipe = moveReaderSwipe(swipe, { ...start, x: 100, y: 260, time: 100 })

  expect(finishReaderSwipe(swipe, { ...start, x: 80, time: 200 })).toBeNull()
})

test('pinch and multi-touch cancel rather than navigating on the remaining finger', () => {
  const swipe = moveReaderSwipe(beginReaderSwipe(start, 390), { ...start, pointers: 2 })

  expect(swipe).toBeNull()
  expect(finishReaderSwipe(swipe, { ...start, x: 80, time: 200 })).toBeNull()
  expect(beginReaderSwipe({ ...start, pointers: 2 }, 390)).toBeNull()
})

test('invalid platform coordinates are rejected', () => {
  expect(beginReaderSwipe({ ...start, x: NaN }, 390)).toBeNull()
  expect(beginReaderSwipe(start, Infinity)).toBeNull()
  expect(finishReaderSwipe(beginReaderSwipe(start, 390), { ...start, time: NaN })).toBeNull()
})
