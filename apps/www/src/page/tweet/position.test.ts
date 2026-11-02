import { describe, expect, it } from 'vitest'

import { checkpointKey, readPosition, savePosition } from './position'

const memoryStorage = () => {
  const values = new Map<string, string>()

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

describe('durable tweet positions', () => {
  it('keeps accounts and anonymous reading separate and clears only the selected account', () => {
    const storage = memoryStorage()
    savePosition('anonymous', 'guest-tweet', () => storage)
    savePosition('alice', 'alice-tweet', () => storage)
    savePosition('bob', 'bob-tweet', () => storage)
    expect(readPosition('anonymous', () => storage)).toBe('guest-tweet')
    expect(readPosition('alice', () => storage)).toBe('alice-tweet')
    expect(readPosition('bob', () => storage)).toBe('bob-tweet')
    savePosition('alice', null, () => storage)
    expect(readPosition('alice', () => storage)).toBeNull()
    expect(readPosition('bob', () => storage)).toBe('bob-tweet')
  })

  it('rejects malformed and alias checkpoints without replacing valid progress', () => {
    const storage = memoryStorage()
    savePosition('alice', 'valid-tweet', () => storage)
    savePosition('alice', '/tweet/invalid', () => storage)
    expect(readPosition('alice', () => storage)).toBe('valid-tweet')
    storage.setItem(checkpointKey('alice'), 'latest')
    expect(readPosition('alice', () => storage)).toBeNull()
  })

  it('tolerates storage being denied or unavailable', () => {
    const denied = () => {
      throw new DOMException('Storage denied', 'SecurityError')
    }

    expect(readPosition('alice', denied)).toBeNull()
    expect(() => savePosition('alice', 'tweet', denied)).not.toThrow()
    expect(() => savePosition('alice', null, denied)).not.toThrow()
  })
})
