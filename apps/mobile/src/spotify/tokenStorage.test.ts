import { expect, test } from 'vitest'

import { spotifyTokenStorage } from './tokenStorage'

test('hydrates stored tokens on the ordinary success path', async () => {
  const tokens = spotifyTokenStorage({
    read: async () => 'old tokens',
    write: async () => {},
    remove: async () => {},
  })

  await tokens.hydrate()
  expect(tokens.storage.getItem('spotify-effect:tokens')).toBe('old tokens')
})

test('stale SDK deletion is fenced while explicit invalidation remains unconditional', async () => {
  let persisted: string | null = null

  const tokens = spotifyTokenStorage({
    read: async () => persisted,
    write: async (value) => {
      persisted = value
    },
    remove: async () => {
      persisted = null
    },
  })

  tokens.storage.setItem('spotify-effect:tokens', 'replacement tokens')
  await tokens.settled()
  tokens.guardWrites(() => false)
  tokens.storage.removeItem('spotify-effect:tokens')
  tokens.storage.clear()
  await tokens.settled()
  expect(tokens.storage.getItem('spotify-effect:tokens')).toBe('replacement tokens')
  expect(persisted).toBe('replacement tokens')
  tokens.invalidate()
  await tokens.settled()
  expect(tokens.storage.getItem('spotify-effect:tokens')).toBeNull()
  expect(persisted).toBeNull()
})

test('token persistence orders a pending write before disconnect deletion and rejects stale SDK writes', async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let stored: string | null = null

  const tokens = spotifyTokenStorage({
    read: async () => stored,
    write: async (value) => {
      started.resolve()
      await release.promise
      stored = value
    },
    remove: async () => {
      stored = null
    },
  })

  let current = true
  tokens.guardWrites(() => current)
  tokens.storage.setItem('spotify-effect:tokens', 'accepted')
  await started.promise
  current = false
  tokens.invalidate()
  tokens.storage.setItem('spotify-effect:tokens', 'late exchange')
  expect(tokens.storage.getItem('spotify-effect:tokens')).toBeNull()
  release.resolve()
  await tokens.settled()
  expect(stored).toBeNull()
})

test('delayed SecureStore hydration cannot restore invalidated tokens or replace a newer write', async () => {
  for (const replacement of [null, 'new tokens']) {
    const read = Promise.withResolvers<string | null>()

    const tokens = spotifyTokenStorage({
      read: () => read.promise,
      write: async () => {},
      remove: async () => {},
    })

    const hydration = tokens.hydrate()
    tokens.invalidate()

    if (replacement) tokens.storage.setItem('spotify-effect:tokens', replacement)
    read.resolve('old tokens')
    await hydration
    expect(tokens.storage.getItem('spotify-effect:tokens')).toBe(replacement)
    await tokens.settled()
  }
})
