import { describe, expect, it } from 'vitest'

import type { Status } from './model'
import { startSignupChallenge, type ChallengeWidget } from './runtime'

const fixture = (
  options: {
    readonly script?: boolean
    readonly sitekey?: string
    readonly preparationFails?: boolean
  } = {},
) => {
  const statuses: Array<Status> = []
  const widgets: Array<Parameters<ChallengeWidget['render']>[0]> = []
  const resets: Array<string> = []
  const removed: Array<string> = []

  const scripts: Array<{
    readonly loaded: () => void
    readonly fail: () => void
    disposed: boolean
  }> = []

  const requests: Array<{
    readonly token: string
    readonly signal: AbortSignal
    readonly resolve: (response: Response) => void
    readonly reject: (error: Error) => void
  }> = []

  const redirects: Array<string> = []
  let available = !options.script
  let preparationFails = options.preparationFails

  const api: ChallengeWidget = {
    render: (widget) => {
      widgets.push(widget)

      return 'fixture-widget'
    },
    reset: (id) => {
      resets.push(id)
    },
    remove: (id) => {
      removed.push(id)
    },
  }

  const runtime = startSignupChallenge({
    sitekey: options.sitekey ?? 'fixture-sitekey',
    action: 'account-signup',
    status: (status) => {
      statuses.push(status)
    },
    widget: () => (available ? api : undefined),
    loadScript: (loaded, fail) => {
      const script = { loaded, fail, disposed: false }
      scripts.push(script)

      return () => {
        script.disposed = true
      }
    },
    prepare: (token, signal) => {
      if (preparationFails) {
        preparationFails = false
        throw new Error('fixture form preparation failure')
      }

      return () =>
        new Promise<Response>((resolve, reject) => {
          requests.push({ token, signal, resolve, reject })
        })
    },
    redirect: (url) => {
      redirects.push(url)
    },
  })

  runtime.start()

  return {
    runtime,
    statuses,
    widgets,
    resets,
    removed,
    scripts,
    requests,
    redirects,
    makeAvailable: () => {
      available = true
    },
  }
}

describe('signup challenge runtime', () => {
  it('reports synchronous preparation failure and allows a fresh submission', async () => {
    const f = fixture({ preparationFails: true })
    f.widgets[0]?.callback('token')
    await f.runtime.submit()
    expect(f.statuses.at(-1)).toBe('failed')
    expect(f.requests).toEqual([])
    await f.runtime.submit()
    expect(f.requests).toEqual([])
    f.runtime.retry()
    f.widgets[0]?.callback('new-token')
    const pending = f.runtime.submit()
    expect(f.requests.map(({ token }) => token)).toEqual(['new-token'])
    f.requests[0]?.resolve(new Response('', { status: 400 }))
    await pending
    expect(f.statuses.at(-1)).toBe('failed')
    f.runtime.dispose()
  })

  it.each([false, true])('keeps retry inert after disposal with script loading %s', (script) => {
    const f = fixture({ script })
    f.runtime.dispose()
    const statuses = [...f.statuses]
    const scripts = f.scripts.length
    f.runtime.retry()
    expect(f.scripts).toHaveLength(scripts)
    expect(f.scripts.every(({ disposed }) => disposed)).toBe(true)
    expect(f.resets).toEqual([])
    expect(f.widgets).toHaveLength(script ? 0 : 1)
    expect(f.statuses).toEqual(statuses)
  })

  it.each([
    { status: 400, redirected: true },
    { status: 200, redirected: false },
  ])('rejects a response with status $status and redirected $redirected', async (result) => {
    class Result extends Response {
      override get redirected() {
        return result.redirected
      }
      override get url() {
        return 'https://fixture.invalid/complete'
      }
    }

    const f = fixture()
    f.widgets[0]?.callback('token')
    const pending = f.runtime.submit()
    f.requests[0]?.resolve(new Result('', { status: result.status }))
    await pending
    expect(f.redirects).toEqual([])
    expect(f.statuses.at(-1)).toBe('failed')
    f.runtime.dispose()
  })
  it('redirects only a successful redirected response', async () => {
    class Redirected extends Response {
      override get redirected() {
        return true
      }
      override get url() {
        return 'https://fixture.invalid/complete'
      }
    }

    const f = fixture()
    f.widgets[0]?.callback('token')
    const pending = f.runtime.submit()
    f.requests[0]?.resolve(new Redirected())
    await pending
    expect(f.redirects).toEqual(['https://fixture.invalid/complete'])
    expect(f.statuses.at(-1)).toBe('submitting')
    await f.runtime.submit()
    expect(f.requests).toHaveLength(1)
  })

  it('reports synchronous widget failure and can retry rendering', () => {
    let attempts = 0
    const statuses: Array<Status> = []

    const runtime = startSignupChallenge({
      sitekey: 'fixture',
      action: 'account-signup',
      widget: () => ({
        render: () => {
          attempts += 1

          if (attempts === 1) throw new Error('fixture render error')

          return 'widget'
        },
        reset: () => undefined,
        remove: () => undefined,
      }),
      loadScript: () => () => undefined,
      status: (status) => {
        statuses.push(status)
      },
      prepare: () => async () => new Response(),
      redirect: () => undefined,
    })

    runtime.start()
    expect(statuses).toEqual(['verifying', 'failed'])
    runtime.retry()
    expect(attempts).toBe(2)
    runtime.dispose()
  })

  it('keeps an unavailable challenge inert', async () => {
    const f = fixture({ sitekey: '' })
    expect(f.statuses).toEqual(['unavailable'])
    expect(f.widgets).toEqual([])
    await f.runtime.submit()
    expect(f.requests).toEqual([])
  })

  it('invalidates expired tokens and resets the existing widget on retry', async () => {
    const f = fixture()
    const widget = f.widgets[0]
    widget?.callback('first')
    widget?.['expired-callback']()
    await f.runtime.submit()
    expect(f.requests).toEqual([])
    f.runtime.retry()
    expect(f.resets).toEqual(['fixture-widget'])
    expect(f.widgets).toHaveLength(1)
    widget?.callback('second')
    const pending = f.runtime.submit()
    await f.runtime.submit()
    expect(f.requests.map(({ token }) => token)).toEqual(['second'])
    f.requests[0]?.resolve(new Response('', { status: 400 }))
    await pending
    expect(f.statuses).toEqual([
      'verifying',
      'ready',
      'failed',
      'verifying',
      'ready',
      'submitting',
      'failed',
    ])
  })

  it('replaces failed scripts, handles missing APIs and removes resources on disposal', () => {
    const f = fixture({ script: true })
    f.scripts[0]?.fail()
    f.runtime.retry()
    expect(f.scripts[0]?.disposed).toBe(true)
    f.scripts[1]?.loaded()
    expect(f.statuses.at(-1)).toBe('failed')
    f.makeAvailable()
    f.scripts[1]?.loaded()
    expect(f.widgets).toHaveLength(1)
    f.runtime.dispose()
    expect(f.scripts[1]?.disposed).toBe(true)
    expect(f.removed).toEqual(['fixture-widget'])
    const before = [...f.statuses]
    f.widgets[0]?.callback('late-token')
    f.widgets[0]?.['timeout-callback']()
    expect(f.statuses).toEqual(before)
  })

  it('aborts pending submission and ignores late success and widget callbacks', async () => {
    const f = fixture()
    f.widgets[0]?.callback('token')
    const pending = f.runtime.submit()
    f.runtime.dispose()
    expect(f.requests[0]?.signal.aborted).toBe(true)
    const before = [...f.statuses]
    f.requests[0]?.resolve(new Response())
    await pending
    f.widgets[0]?.['error-callback']()
    await f.runtime.submit()
    expect(f.statuses).toEqual(before)
    expect(f.redirects).toEqual([])
    expect(f.requests).toHaveLength(1)
  })

  it.each(['rejection', 'response'])(
    'retains a replacement token when the old submission fails by %s',
    async (failure) => {
      const f = fixture()
      f.widgets[0]?.callback('first')
      const pending = f.runtime.submit()
      f.runtime.retry()
      f.widgets[0]?.callback('replacement')
      await f.runtime.submit()
      expect(f.requests).toHaveLength(1)

      if (failure === 'rejection') f.requests[0]?.reject(new Error('fixture network failure'))
      else f.requests[0]?.resolve(new Response('', { status: 400 }))
      await pending
      expect(f.statuses.at(-1)).toBe('ready')
      const replacement = f.runtime.submit()
      expect(f.requests.map(({ token }) => token)).toEqual(['first', 'replacement'])
      f.requests[1]?.resolve(new Response('', { status: 400 }))
      await replacement
      expect(f.statuses.at(-1)).toBe('failed')
      f.runtime.dispose()
    },
  )
})
