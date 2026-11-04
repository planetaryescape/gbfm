import { Observability } from '@gbfm/observability'
import { journeyObserver, noJourneys, type JourneyObserver } from '@gbfm/observability/callbacks'
import { Effect, type Layer, ManagedRuntime } from 'effect'
import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react'

const ObservabilityContext = createContext<JourneyObserver | null>(null)

export function ObservabilityProvider({
  children,
  layer,
}: PropsWithChildren<{
  readonly layer: Layer.Layer<Observability>
}>) {
  const [current, setCurrent] = useState<{
    readonly layer: Layer.Layer<Observability>
    readonly lifetime: { active: boolean }
    readonly observer: JourneyObserver
  } | null>(null)

  useEffect(() => {
    const runtime = ManagedRuntime.make(layer)
    const lifetime = { active: true }
    void runtime.runPromise(Observability).then(
      (service) => {
        if (!lifetime.active) return
        const callbacks = journeyObserver(service)

        const observer: JourneyObserver = {
          start: (name) => {
            if (!lifetime.active) return () => {}

            const finish = callbacks.start(name)

            return (outcome) => {
              if (lifetime.active) finish(outcome)
            }
          },
        }

        setCurrent({ layer, lifetime, observer })
      },
      () => {
        if (!lifetime.active) return
        Effect.runSync(Effect.logWarning({ operation: 'observability.startup', outcome: 'failed' }))
        setCurrent({ layer, lifetime, observer: noJourneys })
      },
    )

    return () => {
      lifetime.active = false
      void runtime.dispose().catch(() => {
        Effect.runSync(
          Effect.logWarning({ operation: 'observability.shutdown', outcome: 'failed' }),
        )
      })
    }
  }, [layer])

  if (!current || current.layer !== layer || !current.lifetime.active) return null

  return <ObservabilityContext value={current.observer}>{children}</ObservabilityContext>
}

export function useJourneys() {
  const observer = useContext(ObservabilityContext)

  if (!observer) throw new Error('ObservabilityProvider is required')

  return observer
}
