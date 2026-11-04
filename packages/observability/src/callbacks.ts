import { Effect } from 'effect'

import type { JourneyName, JourneyOutcome, Observability } from './observability'

export type JourneyObserver = {
  readonly start: (name: JourneyName) => (outcome: JourneyOutcome) => void
}

export const noJourneys: JourneyObserver = { start: () => () => {} }

export const journeyObserver = (service: Observability['Service']): JourneyObserver => ({
  start: (name) => {
    const journey = Effect.runSync(service.start(name))

    return (outcome) => Effect.runSync(journey.finish(outcome))
  },
})
