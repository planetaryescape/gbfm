import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPreviewSession, isPrivateMedia } from './session'

const url = 'https://cdn.goosebumps.fm/user-content/private/owner/id/track.mp3'

afterEach(() => vi.useRealTimers())

describe('private preview session', () => {
  it('opts only the reserved HTTPS namespace in', () => {
    expect(isPrivateMedia(url)).toBe(true)
    expect(
      isPrivateMedia(
        'https://cdn.goosebumps.fm/user-content/private/user/multipart/uuid/123/audio_file.mp3',
      ),
    ).toBe(true)
    expect(
      isPrivateMedia('https://cdn.goosebumps.fm/user-content/private/user/image/uuid/file.webp'),
    ).toBe(true)
    expect(isPrivateMedia(url.replace('/private/', '/public/'))).toBe(false)
    expect(isPrivateMedia(url.replace('https:', 'http:'))).toBe(false)
    expect(isPrivateMedia('/cover.webp')).toBe(false)
  })

  it('installs credentials, coalesces requests, and rechecks permission after two minutes', async () => {
    vi.useFakeTimers()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let denied = 0

    const session = createPreviewSession(url, {
      now: Date.now,
      onDenied: () => {
        denied++
      },
      fetch: async (input, init) => {
        const path =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input

        calls.push({ url: path, init })

        return path.startsWith('/api/')
          ? Response.json({
              sessionUrl: 'https://cdn.goosebumps.fm/preview-session',
              grant: 'disposable',
              expiresAt: Date.now() + 300_000,
            })
          : new Response(null, { status: 204 })
      },
    })

    expect(await Promise.all([session.ensure(), session.ensure()])).toEqual([
      { ok: true },
      { ok: true },
    ])
    expect(calls).toHaveLength(2)
    expect(calls[0]?.init).toMatchObject({
      credentials: 'same-origin',
      body: JSON.stringify({ url }),
    })
    expect(calls[1]?.init).toMatchObject({
      credentials: 'include',
      body: JSON.stringify({ grant: 'disposable' }),
    })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(calls).toHaveLength(4)
    expect(denied).toBe(0)
    session.dispose()
    expect(calls[0]?.init?.signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(calls).toHaveLength(4)
  })

  it('reports denial once without retry storms or installing a cookie', async () => {
    vi.useFakeTimers()
    let requests = 0
    let denied = 0

    const session = createPreviewSession(url, {
      now: Date.now,
      onDenied: () => {
        denied++
      },
      fetch: async () => {
        requests++

        return new Response(null, { status: 403 })
      },
    })

    expect(await session.ensure()).toEqual({ ok: false })
    expect(await session.ensure()).toEqual({ ok: false })
    await vi.advanceTimersByTimeAsync(600_000)
    expect({ requests, denied }).toEqual({ requests: 1, denied: 1 })
    session.dispose()
  })

  it('rejects malformed data and off-origin session endpoints without sending grants', async () => {
    for (const body of [
      {},
      {
        sessionUrl: 'https://attacker.example/preview-session',
        grant: 'private',
        expiresAt: Date.now() + 300_000,
      },
    ]) {
      let requests = 0

      const session = createPreviewSession(url, {
        now: Date.now,
        onDenied: () => undefined,
        fetch: async () => {
          requests++

          return Response.json(body)
        },
      })

      expect(await session.ensure()).toEqual({ ok: false })
      expect(requests).toBe(1)
      session.dispose()
    }
  })

  it('rechecks immediately on return and online, coalescing adjacent events', async () => {
    vi.useFakeTimers()
    const document = new EventTarget()
    const window = new EventTarget()
    let requests = 0

    const session = createPreviewSession(url, {
      now: Date.now,
      onDenied: () => undefined,
      document,
      window,
      fetch: async (input) => {
        const path =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input

        requests++

        return path.startsWith('/api/')
          ? Response.json({
              sessionUrl: 'https://cdn.goosebumps.fm/preview-session',
              grant: 'disposable',
              expiresAt: Date.now() + 300_000,
            })
          : new Response(null, { status: 204 })
      },
    })

    await session.ensure()
    await vi.advanceTimersByTimeAsync(10_000)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    await session.ensure()
    expect(requests).toBe(4)
    session.dispose()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(requests).toBe(4)
  })

  it('keeps disposal terminal even when installed credentials have not expired', async () => {
    vi.useFakeTimers()
    let requests = 0

    const session = createPreviewSession(url, {
      now: Date.now,
      onDenied: () => undefined,
      fetch: async () => {
        requests++

        return requests === 1
          ? Response.json({
              sessionUrl: 'https://cdn.goosebumps.fm/preview-session',
              grant: 'disposable',
              expiresAt: Date.now() + 300_000,
            })
          : new Response(null, { status: 204 })
      },
    })

    expect(await session.ensure()).toEqual({ ok: true })
    session.dispose()
    session.dispose()

    expect(await session.ensure()).toEqual({ ok: false })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(requests).toBe(2)
  })

  it('does not install a grant returned after disposal even if fetch ignores cancellation', async () => {
    vi.useFakeTimers()
    const grant = Promise.withResolvers<Response>()
    const requesting = Promise.withResolvers<void>()
    let requests = 0
    let denied = 0

    const session = createPreviewSession(url, {
      now: Date.now,
      onDenied: () => {
        denied++
      },
      fetch: async () => {
        requests++
        requesting.resolve()

        return requests === 1 ? grant.promise : new Response(null, { status: 204 })
      },
    })

    const pending = session.ensure()
    expect(session.ensure()).toBe(pending)
    await requesting.promise
    session.dispose()
    grant.resolve(
      Response.json({
        sessionUrl: 'https://cdn.goosebumps.fm/preview-session',
        grant: 'disposable',
        expiresAt: Date.now() + 300_000,
      }),
    )

    expect(await pending).toEqual({ ok: false })
    expect(await session.ensure()).toEqual({ ok: false })
    await vi.advanceTimersByTimeAsync(600_000)
    expect({ requests, denied }).toEqual({ requests: 1, denied: 0 })
  })

  it('ignores installation results and failures after disposal', async () => {
    vi.useFakeTimers()

    for (const outcome of ['accepted', 'failed']) {
      const installation = Promise.withResolvers<Response>()
      const installing = Promise.withResolvers<void>()
      let requests = 0
      let denied = 0

      const session = createPreviewSession(url, {
        now: Date.now,
        onDenied: () => {
          denied++
        },
        fetch: async () => {
          requests++

          if (requests === 1)
            return Response.json({
              sessionUrl: 'https://cdn.goosebumps.fm/preview-session',
              grant: 'disposable',
              expiresAt: Date.now() + 300_000,
            })

          installing.resolve()

          return installation.promise
        },
      })

      const pending = session.ensure()
      await installing.promise
      expect(session.ensure()).toBe(pending)
      session.dispose()

      if (outcome === 'accepted') installation.resolve(new Response(null, { status: 204 }))
      else installation.reject(new Error('Installation failed'))

      expect(await pending).toEqual({ ok: false })
      expect(await session.ensure()).toEqual({ ok: false })
      await vi.advanceTimersByTimeAsync(600_000)
      expect({ requests, denied }).toEqual({ requests: 2, denied: 0 })
    }
  })

  it('allows an explicit retry after the denial throttle without retrying automatically', async () => {
    vi.useFakeTimers()
    let requests = 0
    let denied = 0

    const session = createPreviewSession(url, {
      now: Date.now,
      onDenied: () => {
        denied++
      },
      fetch: async () => {
        requests++

        if (requests === 1) return new Response(null, { status: 403 })

        return requests === 2
          ? Response.json({
              sessionUrl: 'https://cdn.goosebumps.fm/preview-session',
              grant: 'disposable',
              expiresAt: Date.now() + 300_000,
            })
          : new Response(null, { status: 204 })
      },
    })

    expect(await session.ensure()).toEqual({ ok: false })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(await session.ensure()).toEqual({ ok: false })
    expect({ requests, denied }).toEqual({ requests: 1, denied: 1 })
    await vi.advanceTimersByTimeAsync(1)
    expect(requests).toBe(1)
    expect(await session.ensure()).toEqual({ ok: true })
    expect({ requests, denied }).toEqual({ requests: 3, denied: 1 })
    session.dispose()
  })

  it('does not start a request when disposed before its scheduled work runs', async () => {
    let requests = 0

    const session = createPreviewSession(url, {
      now: Date.now,
      onDenied: () => undefined,
      fetch: async () => {
        requests++

        return new Response(null, { status: 403 })
      },
    })

    const pending = session.ensure()
    session.dispose()

    expect(await pending).toEqual({ ok: false })
    expect(requests).toBe(0)
  })

  it('releases a failed request even when the fetch adapter throws synchronously', async () => {
    vi.useFakeTimers()
    let requests = 0
    let denied = 0

    const session = createPreviewSession(url, {
      now: Date.now,
      onDenied: () => {
        denied++
      },
      fetch: () => {
        requests++
        throw new Error('Fetch unavailable')
      },
    })

    expect(await session.ensure()).toEqual({ ok: false })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await session.ensure()).toEqual({ ok: false })
    expect({ requests, denied }).toEqual({ requests: 2, denied: 2 })
    session.dispose()
  })
})
