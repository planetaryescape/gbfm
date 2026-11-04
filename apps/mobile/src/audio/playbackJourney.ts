import type { JourneyOutcome } from '@gbfm/observability'
import { noJourneys, type JourneyObserver } from '@gbfm/observability/callbacks'

export const playbackJourney = (observer: JourneyObserver = noJourneys) => {
  let pending: ReturnType<JourneyObserver['start']> | undefined

  const finish = (outcome: JourneyOutcome) => {
    const complete = pending
    pending = undefined
    complete?.(outcome)
  }

  return {
    replace: () => {
      finish('canceled')
      pending = observer.start('playback.start')
    },
    status: (status: { readonly playing: boolean; readonly error: string | null }) => {
      if (status.error) finish('failed')
      else if (status.playing) finish('succeeded')
    },
    fail: () => finish('failed'),
    cancel: () => finish('canceled'),
  }
}
