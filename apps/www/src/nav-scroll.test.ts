import { describe, expect, it } from 'vitest'

import { nextScrollState } from './features/navigation/links'

describe('mobile navigation scroll minimizing', () => {
  it('minimizes after scrolling down past the top zone', () => {
    expect(nextScrollState({ y: 60, minimized: false }, 120)).toEqual({ y: 120, minimized: true })
  })

  it('expands after scrolling back up', () => {
    expect(nextScrollState({ y: 400, minimized: true }, 360)).toEqual({ y: 360, minimized: false })
  })

  it('ignores small movements so the bar does not flicker', () => {
    const state = { y: 400, minimized: true }

    expect(nextScrollState(state, 392)).toBe(state)
    expect(nextScrollState(state, 410)).toBe(state)
  })

  it('always expands near the top of the page', () => {
    expect(nextScrollState({ y: 30, minimized: true }, 40)).toEqual({ y: 40, minimized: false })
  })
})
