import { JourneyOutcome, Observability } from '@gbfm/observability'
import { journeyObserver, type JourneyObserver } from '@gbfm/observability/callbacks'
import { Effect, Layer, Option, Schema } from 'effect'

import { navigationEnd, navigationStart } from '../app/navigation-events'

const completion = Schema.decodeUnknownOption(Schema.Struct({ outcome: JourneyOutcome }))

export const observeNavigation = (target: EventTarget, observer: JourneyObserver) => {
  let pending: ((outcome: JourneyOutcome) => void) | undefined

  const finish = (outcome: JourneyOutcome) => {
    const current = pending
    pending = undefined
    current?.(outcome)
  }

  const started = () => {
    finish('canceled')
    pending = observer.start('navigation')
  }

  const completed = (event: Event) => {
    if (!('detail' in event)) {
      finish('succeeded')

      return
    }

    const decoded = completion(event.detail)

    if (Option.isSome(decoded)) finish(decoded.value.outcome)
  }

  const hidden = () => finish('canceled')
  target.addEventListener(navigationStart, started)
  target.addEventListener(navigationEnd, completed)
  target.addEventListener('pagehide', hidden)

  return () => {
    target.removeEventListener(navigationStart, started)
    target.removeEventListener(navigationEnd, completed)
    target.removeEventListener('pagehide', hidden)
    finish('canceled')
  }
}

export const browserNavigationLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const service = yield* Observability
    yield* Effect.acquireRelease(
      Effect.sync(() => observeNavigation(window, journeyObserver(service))),
      (dispose) => Effect.sync(dispose),
    )
  }),
)
