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
    readonly observer: JourneyObserver
  } | null>(null)

  useEffect(() => {
    const runtime = ManagedRuntime.make(layer)
    let active = true
    void runtime.runPromise(Observability).then(
      (service) => {
        if (active) setCurrent({ layer, observer: journeyObserver(service) })
      },
      () => {
        Effect.runSync(Effect.logWarning({ operation: 'observability.startup', outcome: 'failed' }))

        if (active) setCurrent({ layer, observer: noJourneys })
      },
    )

    return () => {
      active = false
      void runtime.dispose()
    }
  }, [layer])

  if (!current || current.layer !== layer) return null

  return <ObservabilityContext value={current.observer}>{children}</ObservabilityContext>
}

export function useJourneys() {
  const observer = useContext(ObservabilityContext)

  if (!observer) throw new Error('ObservabilityProvider is required')

  return observer
}
