import { describe, expect, it } from 'vitest'

import { consumeCallback, safeReturnPath } from './runtime'

describe('Spotify authorization boundary', () => {
  it('consumes cancelled login state without producing an exchangeable callback', () => {
    const values = new Map([
      ['gbfm:spotify-oauth-state', 'expected'],
      ['gbfm:spotify-return-path', '/tweet/fixture'],
    ])

    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key)
      },
    }

    expect(
      consumeCallback(
        new URL('https://goosebumps.fm/spotify/callback?error=access_denied&state=expected'),
        storage,
      ),
    ).toBeNull()
    expect(values.size).toBe(0)
    expect(
      consumeCallback(
        new URL('https://goosebumps.fm/spotify/callback?code=late-code&state=expected'),
        storage,
      ),
    ).toBeNull()
  })
  it.each([
    'https://other.example/path',
    '//other.example',
    '/\\other.example',
    '/spotify/callback?code=x',
    null,
  ])('rejects unsafe return destinations: %s', (path) => {
    expect(safeReturnPath(path)).toBe('/dashboard/integrations')
  })

  it('retains same-site paths, query, and fragment', () => {
    expect(safeReturnPath('/dashboard/player?tab=spotify#connection')).toBe(
      '/dashboard/player?tab=spotify#connection',
    )
  })

  it.each(['expected', 'wrong', ''])('consumes callback state once: %s', (state) => {
    const values = new Map([
      ['gbfm:spotify-oauth-state', 'expected'],
      ['gbfm:spotify-return-path', '/dashboard/player'],
    ])

    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key)
      },
    }

    const url = new URL(`https://goosebumps.fm/spotify/callback?code=fixture-code&state=${state}`)
    expect(consumeCallback(url, storage)).toEqual(
      state === 'expected' ? { code: 'fixture-code', destination: '/dashboard/player' } : null,
    )
    expect(values.size).toBe(0)
    expect(consumeCallback(url, storage)).toBeNull()
  })
})
