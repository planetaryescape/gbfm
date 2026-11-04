import type { JourneyName, JourneyOutcome, JourneySink } from '../observability/journey'

export const recordingJourneys = () => {
  const records: Array<{ name: JourneyName; outcome: JourneyOutcome; durationMs: number }> = []
  const starts: Array<JourneyName> = []
  let time = 0

  const sink: JourneySink = {
    start: (name) => {
      starts.push(name)

      return (outcome, durationMs) => records.push({ name, outcome, durationMs })
    },
  }

  return {
    sink,
    records,
    starts,
    now: () => time,
    advance: (ms: number) => {
      time += ms
    },
  }
}
