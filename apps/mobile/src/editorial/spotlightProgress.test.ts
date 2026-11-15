import { describe, expect, it } from 'vitest'

import { emptyProgress, stepTo } from './progressState'

describe('stepTo', () => {
  it('moves to a position and records it as seen once', () => {
    const first = stepTo(emptyProgress, '1.1')
    const again = stepTo(stepTo(first, '1.2'), '1.1')

    expect(first).toEqual({ at: '1.1', seen: ['1.1'] })
    expect(again).toEqual({ at: '1.1', seen: ['1.1', '1.2'] })
  })

  it('records the intro under its own name', () => {
    expect(stepTo(emptyProgress, null)).toEqual({ at: null, seen: ['intro'] })
  })
})
