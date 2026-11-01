export type SwipePoint = {
  readonly x: number
  readonly y: number
  readonly time: number
  readonly pointers: number
}

export type ReaderSwipe = {
  readonly origin: SwipePoint
  readonly width: number
  readonly samples: ReadonlyArray<SwipePoint>
  readonly axis: 'pending' | 'horizontal' | 'vertical'
  readonly maxVertical: number
}

const validPoint = (point: SwipePoint) => {
  'worklet'

  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.time) &&
    point.pointers === 1
  )
}

export const beginReaderSwipe = (point: SwipePoint, viewportWidth: number): ReaderSwipe | null => {
  'worklet'

  return validPoint(point) &&
    Number.isFinite(viewportWidth) &&
    point.x > 32 &&
    point.x < viewportWidth - 32
    ? { origin: point, width: viewportWidth, samples: [point], axis: 'pending', maxVertical: 0 }
    : null
}

export const moveReaderSwipe = (
  swipe: ReaderSwipe | null,
  point: SwipePoint,
): ReaderSwipe | null => {
  'worklet'

  if (!swipe || !validPoint(point) || point.time < (swipe.samples.at(-1)?.time ?? 0)) return null

  if (swipe.axis === 'pending' && point.time - swipe.origin.time > 700) return null

  const horizontal = Math.abs(point.x - swipe.origin.x)
  const vertical = Math.abs(point.y - swipe.origin.y)
  const maxVertical = Math.max(swipe.maxVertical, vertical)
  const samples = [...swipe.samples.filter((sample) => point.time - sample.time <= 100), point]

  if (swipe.axis !== 'pending') return { ...swipe, maxVertical, samples }

  if (horizontal >= 12 && horizontal > vertical * 1.8)
    return { ...swipe, axis: 'horizontal', maxVertical, samples }

  return { ...swipe, axis: vertical >= 12 ? 'vertical' : 'pending', maxVertical, samples }
}

export const readerSwipeDistance = (width: number) => {
  'worklet'

  return Math.min(160, Math.max(80, width * 0.25))
}

export const readerSwipeOffset = (swipe: ReaderSwipe | null, available = true) => {
  'worklet'

  if (!swipe || swipe.axis !== 'horizontal' || swipe.maxVertical > 40) return 0

  const dx = (swipe.samples.at(-1)?.x ?? swipe.origin.x) - swipe.origin.x

  return available ? dx : dx * 0.18
}

export const finishReaderSwipe = (
  swipe: ReaderSwipe | null,
  point: SwipePoint,
  releaseVelocity?: number,
): 'older' | 'newer' | null => {
  'worklet'
  const moved = moveReaderSwipe(swipe, point)

  if (!moved || moved.axis !== 'horizontal') return null

  const dx = point.x - moved.origin.x
  const dy = point.y - moved.origin.y
  const first = moved.samples[0]
  const duration = first ? point.time - first.time : 0
  const sampledVelocity = first && duration > 0 ? (point.x - first.x) / duration : 0
  const velocity = releaseVelocity ?? sampledVelocity

  if (!Number.isFinite(velocity)) return null
  const threshold = readerSwipeDistance(moved.width)
  const reversing = velocity * Math.sign(dx) < -0.15

  const flick =
    Math.abs(dx) >= 32 && Math.abs(velocity) >= 0.55 && Math.abs(dx + velocity * 180) >= threshold

  return !reversing &&
    (Math.abs(dx) >= threshold || flick) &&
    moved.maxVertical <= 40 &&
    Math.abs(dx) > Math.abs(dy) * 1.8
    ? dx < 0
      ? 'older'
      : 'newer'
    : null
}
