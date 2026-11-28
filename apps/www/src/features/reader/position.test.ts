import { describe, expect, it } from '@effect/vitest'

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

describe('reader checkpoint storage', () => {
  it('preserves existing keys, separates identities and clears only the selected account', () => {
    const storage = memoryStorage()
    savePosition('anonymous', 'guest-tweet', () => storage)
    savePosition('alice/key', 'alice-tweet', () => storage)
    savePosition('bob', 'bob-tweet', () => storage)
    expect(checkpointKey('alice/key')).toBe('gbfm:tweet-checkpoint:alice%2Fkey')
    expect(readPosition('anonymous', () => storage)).toBe('guest-tweet')
    expect(readPosition('alice/key', () => storage)).toBe('alice-tweet')
    savePosition('alice/key', null, () => storage)
    expect(readPosition('alice/key', () => storage)).toBeNull()
    expect(readPosition('bob', () => storage)).toBe('bob-tweet')
  })

  it('rejects malformed or alias checkpoints without replacing valid progress', () => {
    const storage = memoryStorage()
    savePosition('alice', 'valid-tweet', () => storage)
    savePosition('alice', '/tweet/invalid', () => storage)
    expect(readPosition('alice', () => storage)).toBe('valid-tweet')
    storage.setItem(checkpointKey('alice'), 'latest')
    expect(readPosition('alice', () => storage)).toBeNull()
  })

  it('tolerates unavailable storage without throwing or fabricating progress', () => {
    const denied = () => {
      throw new DOMException('Storage denied', 'SecurityError')
    }

    expect(readPosition('alice', denied)).toBeNull()
    expect(() => savePosition('alice', 'tweet', denied)).not.toThrow()
    expect(() => savePosition('alice', null, denied)).not.toThrow()
  })
})
