import { Observability, type JourneyName } from '@gbfm/observability'
import type { JourneyObserver } from '@gbfm/observability/callbacks'
import { Deferred, Effect, Layer } from 'effect'
import { act, useEffect, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { ObservabilityProvider, useJourneys } from './context'

const previousActEnvironment = Object.getOwnPropertyDescriptor(
  globalThis,
  'IS_REACT_ACT_ENVIRONMENT',
)

beforeAll(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
})

afterAll(() => {
  if (previousActEnvironment)
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment)
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

const render = async (element: ReactElement) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(element)
  })

  return {
    text: () => container.textContent,
    update: (next: ReactElement) => root.render(next),
    unmount: () => {
      root.unmount()
      container.remove()
    },
  }
}

function Consumer({ ready }: { readonly ready: (observer: JourneyObserver) => void }) {
  const observer = useJourneys()
  useEffect(() => {
    ready(observer)
  }, [observer, ready])

  return 'ready'
}

const fixture = (
  options: { readonly reject?: boolean; readonly uninterruptible?: boolean } = {},
) => {
  const entered = Deferred.makeUnsafe<void>()
  const release = Deferred.makeUnsafe<void>()
  const acquired = Deferred.makeUnsafe<void>()
  const disposed = Deferred.makeUnsafe<void>()
  const starts: Array<JourneyName> = []
  const completions: Array<string> = []
  const observed: Array<JourneyObserver> = []

  const ready = (observer: JourneyObserver) => {
    observed.push(observer)
  }

  const acquire = Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Deferred.succeed(disposed, undefined))
    yield* Deferred.succeed(entered, undefined)
    yield* Deferred.await(release)
    yield* Deferred.succeed(acquired, undefined)

    if (options.reject) return yield* Effect.die(new Error('synthetic-secret-do-not-log'))

    return Observability.of({
      start: (name) =>
        Effect.sync(() => {
          starts.push(name)

          return {
            finish: (outcome) =>
              Effect.sync(() => {
                completions.push(outcome)
              }),
          }
        }),
    })
  })

  const layer = Layer.effect(
    Observability,
    options.uninterruptible ? Effect.uninterruptible(acquire) : acquire,
  )

  return {
    layer,
    starts,
    completions,
    observed,
    ready,
    entered: () => Effect.runPromise(Deferred.await(entered)),
    release: async () => {
      Effect.runSync(Deferred.succeed(release, undefined))
      await Effect.runPromise(Deferred.await(acquired))
    },
    disposed: () => Effect.runPromise(Deferred.await(disposed)),
  }
}

test('the provider waits for its Effect layer and exposes the acquired observer', async () => {
  const f = fixture()

  const root = await render(
    <ObservabilityProvider layer={f.layer}>
      <Consumer ready={f.ready} />
    </ObservabilityProvider>,
  )

  try {
    await f.entered()
    expect(root.text()).toBe('')
    await act(f.release)
    expect(root.text()).toBe('ready')
    f.observed[0]?.start('reader.open')('succeeded')
    expect(f.starts).toEqual(['reader.open'])
    expect(f.completions).toEqual(['succeeded'])
  } finally {
    await act(async () => {
      root.unmount()
    })
    await f.disposed()
  }
})

test('failed acquisition renders children with a no-op observer instead of blocking startup', async () => {
  const f = fixture({ reject: true })

  const root = await render(
    <ObservabilityProvider layer={f.layer}>
      <Consumer ready={f.ready} />
    </ObservabilityProvider>,
  )

  try {
    await act(f.release)
    expect(root.text()).toBe('ready')
    expect(f.observed).toHaveLength(1)
    expect(() => f.observed[0]?.start('reader.open')('failed')).not.toThrow()
    expect(f.starts).toEqual([])
  } finally {
    await act(async () => {
      root.unmount()
    })
    await f.disposed()
  }
})

test('replacing a layer hides the disposed observer while the new layer is pending', async () => {
  const first = fixture()
  const second = fixture()

  const root = await render(
    <ObservabilityProvider layer={first.layer}>
      <Consumer ready={first.ready} />
    </ObservabilityProvider>,
  )

  try {
    await act(first.release)
    const old = first.observed[0]

    if (!old) throw new Error('Observer was not acquired')
    const oldFinish = old.start('reader.open')
    await act(async () =>
      root.update(
        <ObservabilityProvider layer={second.layer}>
          <Consumer ready={second.ready} />
        </ObservabilityProvider>,
      ),
    )
    await second.entered()
    await first.disposed()
    expect(root.text()).toBe('')
    old.start('reader.open')('failed')
    oldFinish('failed')
    expect(first.starts).toEqual(['reader.open'])
    expect(first.completions).toEqual([])
    await act(second.release)
    expect(root.text()).toBe('ready')
    second.observed[0]?.start('playback.start')('succeeded')
    expect(second.starts).toEqual(['playback.start'])
  } finally {
    await act(async () => {
      root.unmount()
    })
    await second.disposed()
  }
})

test.each([false, true])(
  'late acquisition after unmount never exposes an observer, rejection: %s',
  async (reject) => {
    const f = fixture({ reject, uninterruptible: true })

    const root = await render(
      <ObservabilityProvider layer={f.layer}>
        <Consumer ready={f.ready} />
      </ObservabilityProvider>,
    )

    await f.entered()
    await act(async () => {
      root.unmount()
    })
    await act(f.release)
    await f.disposed()
    expect(root.text()).toBe('')
    expect(f.observed).toEqual([])
    expect(f.starts).toEqual([])
  },
)
