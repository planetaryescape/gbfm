import { noJourneySink, startJourney, type JourneySink } from '../observability/journey'

export const playbackJourney = (
  sink: JourneySink = noJourneySink,
  now: () => number = () => performance.now(),
) => {
  let pending: ReturnType<typeof startJourney> | undefined

  const finish = (outcome: Parameters<ReturnType<typeof startJourney>>[0]) => {
    const complete = pending
    pending = undefined
    complete?.(outcome)
  }

  return {
    replace: () => {
      finish('canceled')
      pending = startJourney(sink, 'playback.start', now)
    },
    status: (status: { readonly playing: boolean; readonly error: string | null }) => {
      if (status.error) finish('failed')
      else if (status.playing) finish('succeeded')
    },
    fail: () => finish('failed'),
    cancel: () => finish('canceled'),
  }
}
