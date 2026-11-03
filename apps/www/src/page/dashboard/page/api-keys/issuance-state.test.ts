import { IssueKeyInput } from '@gbfm/api/personal-access-keys'
import { Redacted, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { createIssuanceState } from './issuance-state'

const input = Schema.decodeUnknownSync(IssueKeyInput)({
  requestId: 'acb70dde-fc47-4ce6-a2dc-c1067aca7d64',
  name: 'Test key',
  scopes: ['posts:read'],
  expiresInSeconds: 86400,
})

describe('restricted issuance lifecycle', () => {
  it('gates duplicate submissions and releases invalid input for another attempt', () => {
    const state = createIssuanceState()
    expect(state.submit()).toBe(false)
    state.setLive(true)
    expect(state.submit()).toBe(true)
    expect(state.submit()).toBe(false)
    state.clear()
    expect(state.submit()).toBe(true)
  })

  it('retains the same issuance input across password failure and retry', () => {
    const state = createIssuanceState()
    state.setLive(true)
    state.submit()
    state.requestPassword(input)
    expect(state.submit()).toBe(false)
    expect(state.verify()).toBe(true)
    expect(state.verify()).toBe(false)
    state.verificationFailed()
    expect(state.input()).toBe(input)
    expect(state.verify()).toBe(true)
    state.issued(Redacted.make('disposable-test-value'))
    expect(state.input()).toBeNull()
    expect(state.secret()).not.toBeNull()
    expect(state.submit()).toBe(false)
    state.clear()
    expect(state.secret()).toBeNull()
    expect(state.submit()).toBe(true)
  })

  it('cancels pending input but retains in-flight verification ownership while paused', () => {
    const state = createIssuanceState()
    state.setLive(true)
    state.submit()
    state.requestPassword(input)
    state.verify()
    state.setLive(false)
    expect(state.input()).toBeNull()
    expect(state.verifying()).toBe(true)
    state.issued(Redacted.make('disposable-test-value'))
    expect(state.secret()).toBeNull()
    expect(state.verifying()).toBe(false)
    state.setLive(true)
    expect(state.submit()).toBe(true)
  })

  it('preserves cancellation before verification and ignores cancelled confirmation results', () => {
    const state = createIssuanceState()
    state.setLive(true)
    state.submit()
    state.requestPassword(input)
    state.clear()
    expect(state.verify()).toBe(false)
    state.issued(null)
    expect(state.busy()).toBe(false)
    expect(state.secret()).toBeNull()
  })

  it('characterizes pagehide clearing without treating it as view suspension', () => {
    const state = createIssuanceState()
    state.setLive(true)
    state.requestPassword(input)
    state.verify()
    state.clear()
    expect(state.live()).toBe(true)
    expect(state.verifying()).toBe(true)
    state.issued(Redacted.make('disposable-test-value'))
    expect(state.secret()).not.toBeNull()
    state.clear()
    expect(state.secret()).toBeNull()
  })
})
