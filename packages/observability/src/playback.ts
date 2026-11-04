import { noJourneys, type JourneyObserver } from './callbacks'
import type { JourneyOutcome } from './observability'

export const playbackJourney = (observer: JourneyObserver = noJourneys) => {
  let pending: ReturnType<JourneyObserver['start']> | undefined
  let awaitingFirstPlay = false

  const finish = (outcome: JourneyOutcome) => {
    const complete = pending
    pending = undefined
    complete?.(outcome)
  }

  return {
    replace: (intent: 'play' | 'paused' = 'play') => {
      finish('canceled')
      awaitingFirstPlay = true

      if (intent === 'play') pending = observer.start('playback.start')
    },
    play: () => {
      if (awaitingFirstPlay && !pending) pending = observer.start('playback.start')
    },
    status: (status: { readonly playing: boolean; readonly error: string | null }) => {
      if (status.error) finish('failed')
      else if (status.playing) {
        awaitingFirstPlay = false
        finish('succeeded')
      }
    },
    fail: () => finish('failed'),
    cancel: () => finish('canceled'),
  }
}
