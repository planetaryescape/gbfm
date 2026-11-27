import { JourneyOutcome, type JourneyName } from '@gbfm/observability'
import type { JourneyObserver } from '@gbfm/observability/callbacks'
import { Schema } from 'effect'
import { expect, test } from 'vitest'

import { navigationCompleted, navigationEnd, navigationStarted } from '../app/navigation-events'
import { observeNavigation } from './navigation'

const fixture = () => {
  const target = new EventTarget()
  const journeys: Array<{ name: JourneyName; outcomes: Array<JourneyOutcome> }> = []

  const observer: JourneyObserver = {
    start: (name) => {
      const journey = { name, outcomes: new Array<JourneyOutcome>() }
      journeys.push(journey)

      return (outcome) => {
        journey.outcomes.push(outcome)
      }
    },
  }

  return { target, journeys, dispose: observeNavigation(target, observer) }
}

test.each(['succeeded', 'failed', 'empty', 'canceled'])(
  'native navigation records exactly one %s completion',
  (input) => {
    const outcome = Schema.decodeUnknownSync(JourneyOutcome)(input)
    const { target, journeys, dispose } = fixture()
    navigationStarted(target)
    navigationCompleted(outcome, target)
    navigationCompleted('failed', target)
    expect(journeys).toEqual([{ name: 'navigation', outcomes: [outcome] }])
    dispose()
    expect(journeys).toEqual([{ name: 'navigation', outcomes: [outcome] }])
  },
)

test('a newer navigation cancels its predecessor without completing it twice', () => {
  const { target, journeys, dispose } = fixture()
  navigationStarted(target)
  navigationStarted(target)
  navigationCompleted('succeeded', target)
  expect(journeys).toEqual([
    { name: 'navigation', outcomes: ['canceled'] },
    { name: 'navigation', outcomes: ['succeeded'] },
  ])
  dispose()
})

test('pagehide and disposal cancel only the current journey and remove listeners', () => {
  const { target, journeys, dispose } = fixture()
  navigationStarted(target)
  target.dispatchEvent(new Event('pagehide'))
  navigationCompleted('succeeded', target)
  navigationStarted(target)
  dispose()
  navigationStarted(target)
  navigationCompleted('succeeded', target)
  expect(journeys).toEqual([
    { name: 'navigation', outcomes: ['canceled'] },
    { name: 'navigation', outcomes: ['canceled'] },
  ])
})

test('legacy completion events remain valid while malformed details never become labels', () => {
  const { target, journeys, dispose } = fixture()
  navigationStarted(target)
  target.dispatchEvent(
    new CustomEvent(navigationEnd, {
      detail: { outcome: 'private-path?token=synthetic-secret', account: 'private-fixture' },
    }),
  )
  expect(journeys).toEqual([{ name: 'navigation', outcomes: [] }])
  target.dispatchEvent(new Event(navigationEnd))
  expect(journeys).toEqual([{ name: 'navigation', outcomes: ['succeeded'] }])
  expect(JSON.stringify(journeys)).not.toContain('synthetic-secret')
  expect(JSON.stringify(journeys)).not.toContain('private-fixture')
  dispose()
})
