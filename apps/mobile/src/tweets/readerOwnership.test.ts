import { expect, test } from 'vitest'

import { readerOwnership } from './readerOwnership'
import { initialReaderState } from './readerState'

test('blur and unmount abort the visit and action and reject delayed confirmations', () => {
  const owner = readerOwnership()
  const visit = owner.focus()
  const ready = { ...initialReaderState, request: visit.request, status: 'ready' as const }
  const action = owner.beginAction(ready)
  expect(action).not.toBeNull()
  owner.blur(visit.controller)
  expect(visit.controller.signal.aborted).toBe(true)
  expect(action?.controller.signal.aborted).toBe(true)
  expect(owner.beginAction(ready)).toBeNull()
  expect(owner.finishAction(action?.controller ?? visit.controller)).toBe(false)
})

test('refocus and account replacement reject old requests without resetting the sequence', () => {
  const owner = readerOwnership()
  const first = owner.focus()
  const ready = { ...initialReaderState, request: first.request, status: 'ready' as const }
  const action = owner.beginAction(ready)
  owner.blur(first.controller)
  const second = owner.focus()
  expect(second.request).toBe(first.request + 1)
  expect(owner.beginAction(ready)).toBeNull()
  expect(owner.acceptsResult(first.request, action?.controller ?? first.controller)).toBe(false)
  expect(owner.acceptsResult(second.request, second.controller)).toBe(true)
})

test('actions remain single-flight until their own finalizer, including after navigation abort', () => {
  const owner = readerOwnership()
  const visit = owner.focus()
  const ready = { ...initialReaderState, request: visit.request, status: 'ready' as const }
  expect(owner.beginAction(initialReaderState)).toBeNull()
  const first = owner.beginAction(ready)

  if (!first) throw new Error('expected an action')
  expect(owner.beginAction(ready)).toBeNull()
  owner.cancelAction()
  expect(owner.acceptsResult(first.request, first.controller)).toBe(false)
  expect(owner.beginAction(ready)).toBeNull()
  expect(owner.finishAction(first.controller)).toBe(true)
  const second = owner.beginAction(ready)

  if (!second) throw new Error('expected a second action')
  expect(owner.finishAction(first.controller)).toBe(false)
  expect(owner.beginAction(ready)).toBeNull()
  expect(owner.finishAction(second.controller)).toBe(true)
})
