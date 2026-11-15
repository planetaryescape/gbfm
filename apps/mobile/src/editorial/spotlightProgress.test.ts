import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { emptyProgress, SpotlightProgress, stepTo } from './progressState'

describe('stepTo', () => {
  it('preserves the resume position without accumulating visited entries', () => {
    expect(stepTo('1.1')).toEqual({ at: '1.1' })
    expect(stepTo('1.2')).toEqual({ at: '1.2' })
  })

  it('returns to the intro', () => {
    expect(stepTo(null)).toEqual(emptyProgress)
  })

  it('reads existing mobile progress and drops write-only seen data', () => {
    const stored = Schema.decodeUnknownSync(Schema.fromJsonString(SpotlightProgress))(
      JSON.stringify({ at: '2.3', seen: ['intro', '1.1', '2.3'] }),
    )

    expect(stored).toEqual({ at: '2.3' })
    expect(Schema.encodeSync(Schema.fromJsonString(SpotlightProgress))(stored)).toBe('{"at":"2.3"}')
  })
})
