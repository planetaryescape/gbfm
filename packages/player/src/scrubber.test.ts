import { describe, expect, it } from 'vitest'

import { scrubberCurve, scrubberProgress, scrubberTime, startScrubberDrag } from './scrubber'

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
    expect(scrubberCurve(0).x).toBe(56)
    expect(scrubberCurve(0.5).x).toBe(160)
    expect(scrubberCurve(1).x).toBe(264)
    expect(scrubberCurve(-1).x).toBe(56)
    expect(scrubberCurve(2).x).toBe(264)
    expect(scrubberCurve(0).played).toBe('M 12 44 L 12 44 C 36.2 44 36.2 18 56 18')
    expect(scrubberCurve(0.5).played).toBe('M 12 44 L 116 44 C 140.2 44 140.2 18 160 18')
    expect(scrubberCurve(1).track).toContain('C 283.8 18 283.8 44 308 44 L 308 44')
  })

  it('grabs either hill shoulder without jumping and follows relative movement', () => {
    const left = startScrubberDrag(130, 320, 60, 120)
    const right = startScrubberDrag(190, 320, 60, 120)
    expect(left.timeAt(130)).toBe(60)
    expect(right.timeAt(190)).toBe(60)
    expect(left.timeAt(150)).toBeCloseTo(71.53846)
    expect(right.timeAt(170)).toBeCloseTo(48.46154)
    expect(left.timeAt(-100)).toBe(0)
    expect(right.timeAt(500)).toBe(120)
  })

  it('keeps the full hill grabbable at both endpoints and maps track taps to time', () => {
    const start = startScrubberDrag(24, 320, 0, 120)
    expect(start.timeAt(24)).toBe(0)
    expect(start.timeAt(232)).toBe(120)
    const end = startScrubberDrag(300, 320, 120, 120)
    expect(end.timeAt(300)).toBe(120)
    expect(end.timeAt(92)).toBe(0)
    expect(startScrubberDrag(160, 320, 0, 120).timeAt(160)).toBe(60)
    expect(startScrubberDrag(80, 160, 0, 120).timeAt(80)).toBe(60)
  })

  it('refines at the supplied displayed second and caps fine movement at a quarter second', () => {
    const coarse = startScrubberDrag(160, 320, 600, 1200)
    const fine = coarse.refine(173, 675)
    expect(coarse.fine).toBe(false)
    expect(fine.fine).toBe(true)
    expect(fine.timeAt(173)).toBe(675)
    expect(fine.timeAt(177)).toBe(676)
    expect(fine.timeAt(169)).toBe(674)
  })

  it('never accelerates short audio in fine mode', () => {
    const fine = startScrubberDrag(160, 320, 10, 20).refine(160, 10)
    expect(fine.timeAt(160 + 104)).toBe(20)
    expect(fine.timeAt(160 - 104)).toBe(0)
    expect(fine.timeAt(170)).toBeCloseTo(10.961538)
  })

  it('uses the same fine rate and clamping at either endpoint', () => {
    const left = startScrubberDrag(24, 320, 0, 120).refine(24, 0)
    const right = startScrubberDrag(300, 320, 120, 120).refine(300, 120)
    expect(left.timeAt(28)).toBe(1)
    expect(left.timeAt(20)).toBe(0)
    expect(right.timeAt(296)).toBe(119)
    expect(right.timeAt(304)).toBe(120)
  })
})
