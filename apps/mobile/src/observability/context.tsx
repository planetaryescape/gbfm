import { Observability } from '@gbfm/observability'
import { journeyObserver, noJourneys, type JourneyObserver } from '@gbfm/observability/callbacks'
import { type Layer, ManagedRuntime } from 'effect'
import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react'

const ObservabilityContext = createContext<JourneyObserver | null>(null)

export function ObservabilityProvider({
  children,
  layer,
}: PropsWithChildren<{
  readonly layer: Layer.Layer<Observability>
}>) {
  const [observer, setObserver] = useState<JourneyObserver | null>(null)

  useEffect(() => {
    const runtime = ManagedRuntime.make(layer)
    let active = true
    void runtime.runPromise(Observability).then(
      (service) => {
        if (active) setObserver(journeyObserver(service))
      },
      () => {
        if (active) setObserver(noJourneys)
      },
    )

    return () => {
      active = false
      void runtime.dispose()
    }
  }, [layer])

  return observer ? <ObservabilityContext value={observer}>{children}</ObservabilityContext> : null
}

export function useJourneys() {
  const observer = useContext(ObservabilityContext)

  if (!observer) throw new Error('ObservabilityProvider is required')

  return observer
}
