import { Schema } from 'effect'
import { expect, test } from 'vitest'

import { SetFavoriteInput, SetShowSubscriptionInput } from './contracts'

test('desired-state inputs require bounded targets, an exact revision and UUIDv4 retry key', () => {
  const favorite = {
    requestId: 'cefaebc7-45ee-42b1-a77d-591c68fba4df',
    expectedRevision: 0,
    targetKind: 'audio',
    targetId: 'legacy-audio-id',
    desiredState: false,
  }

  const subscription = {
    requestId: favorite.requestId,
    expectedRevision: Number.MAX_SAFE_INTEGER,
    showId: 's'.repeat(200),
    desiredState: true,
  }

  const decodeFavorite = Schema.decodeUnknownSync(SetFavoriteInput, {
    onExcessProperty: 'error',
  })

  const decodeSubscription = Schema.decodeUnknownSync(SetShowSubscriptionInput, {
    onExcessProperty: 'error',
  })

  expect(decodeFavorite(favorite)).toEqual(favorite)
  expect(decodeFavorite({ ...favorite, targetKind: 'show', desiredState: true })).toEqual({
    ...favorite,
    targetKind: 'show',
    desiredState: true,
  })
  expect(decodeSubscription(subscription)).toEqual(subscription)

  for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
    expect(() => decodeFavorite({ ...favorite, expectedRevision })).toThrow()
    expect(() => decodeSubscription({ ...subscription, expectedRevision })).toThrow()
  }

  for (const requestId of ['not-a-uuid', 'cefaebc7-45ee-12b1-a77d-591c68fba4df', undefined]) {
    expect(() => decodeFavorite({ ...favorite, requestId })).toThrow()
    expect(() => decodeSubscription({ ...subscription, requestId })).toThrow()
  }

  for (const targetId of ['', 's'.repeat(201)]) {
    expect(() => decodeFavorite({ ...favorite, targetId })).toThrow()
    expect(() => decodeSubscription({ ...subscription, showId: targetId })).toThrow()
  }

  expect(() => decodeFavorite({ ...favorite, targetKind: 'post' })).toThrow()
  expect(() => decodeFavorite({ ...favorite, desiredState: 'false' })).toThrow()
  expect(() => decodeSubscription({ ...subscription, desiredState: 0 })).toThrow()
  expect(() => decodeFavorite({ ...favorite, userId: 'other-owner' })).toThrow()
  expect(() => decodeSubscription({ ...subscription, userId: 'other-owner' })).toThrow()
})
