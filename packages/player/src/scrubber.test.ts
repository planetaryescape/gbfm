import { describe, expect, it } from 'vitest'

import { scrubberCurve, scrubberProgress, scrubberTime } from './scrubber'

describe('scrubber position', () => {
  it('maps dragging to time and clamps drags beyond either edge', () => {
    expect(scrubberTime(150, 300, 120)).toBe(60)
    expect(scrubberTime(-50, 300, 120)).toBe(0)
    expect(scrubberTime(500, 300, 120)).toBe(120)
  })

  it('stays at the start when duration or layout is unavailable', () => {
    expect(scrubberTime(20, 0, 120)).toBe(0)
    expect(scrubberTime(20, 300, Number.NaN)).toBe(0)
    expect(scrubberProgress(20, 0)).toBe(0)
    expect(scrubberProgress(Number.NaN, 120)).toBe(0)
    expect(scrubberProgress(20, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('keeps the hill and playhead inside the timeline at the start, middle and end', () => {
    expect(scrubberCurve(0).x).toBe(12)
    expect(scrubberCurve(0.5).x).toBe(160)
    expect(scrubberCurve(1).x).toBe(308)
    expect(scrubberCurve(-1).x).toBe(12)
    expect(scrubberCurve(2).x).toBe(308)
    expect(scrubberCurve(0.5).played).toBe('M 12 44 L 116 44 C 140.2 44 140.2 22 160 22')
    expect(scrubberCurve(0.5).track).toContain('C 179.8 22 179.8 44 204 44 L 308 44')
  })
})
