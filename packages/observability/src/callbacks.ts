import { Effect, Exit } from 'effect'

import type { JourneyName, JourneyOutcome, Observability } from './observability'

export type JourneyObserver = {
  readonly start: (name: JourneyName) => (outcome: JourneyOutcome) => void
}

export const noJourneys: JourneyObserver = { start: () => () => {} }

export const journeyObserver = (service: Observability['Service']): JourneyObserver => ({
  start: (name) => {
    const result = Effect.runSyncExit(service.start(name))

    if (Exit.isFailure(result)) return () => {}

    return (outcome) => {
      Effect.runSyncExit(result.value.finish(outcome))
    }
  },
})
