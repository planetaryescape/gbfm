import type { JourneyOutcome } from '@gbfm/observability'

export const navigationStart = 'gbfm:navigation-start'

export const navigationEnd = 'gbfm:navigation-end'

export const navigationStarted = (target: EventTarget = window): void => {
  target.dispatchEvent(new Event(navigationStart))
}

export const navigationCompleted = (
  outcome: JourneyOutcome = 'succeeded',
  target: EventTarget = window,
): void => {
  target.dispatchEvent(new CustomEvent(navigationEnd, { detail: { outcome } }))
}
