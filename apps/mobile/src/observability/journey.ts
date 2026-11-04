export type JourneyName = 'reader.open' | 'playback.start'

export type JourneyOutcome = 'succeeded' | 'failed' | 'canceled' | 'empty'

export type JourneySink = {
  readonly start: (name: JourneyName) => (outcome: JourneyOutcome, durationMs: number) => void
}

export const noJourneySink: JourneySink = { start: () => () => {} }

export const startJourney = (
  sink: JourneySink,
  name: JourneyName,
  now: () => number = () => performance.now(),
) => {
  const startedAt = now()
  let finished = false
  let complete: ReturnType<JourneySink['start']> = () => {}

  try {
    complete = sink.start(name)
  } catch {
    complete = () => {}
  }

  return (outcome: JourneyOutcome) => {
    if (finished) return
    finished = true

    try {
      complete(outcome, Math.max(0, now() - startedAt))
    } catch {
      return
    }
  }
}
