import { it, expect } from '@effect/vitest'
import { Effect } from 'effect'

import { MembershipHttp, SaveMembership } from './commands'

const requestId = '07b60d9b-46b8-41bf-b77a-05085a272e34'

const target = { kind: 'audio', id: '90130641-c498-452f-b9ad-056348ac57e2' } satisfies {
  kind: 'audio'
  id: string
}

const args = {
  target,
  active: true,
  principalId: 'listener',
  generation: 2,
  request: 4,
  expectedRevision: 8,
  mutationId: requestId,
}

it('the command preserves a lost acknowledgement key and rejects a mismatched server receipt', () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []

  const http = MembershipHttp.of({
    requestId: Effect.succeed('must-not-be-used'),
    request: (url, init) => {
      requests.push({ url, init })

      return Effect.succeed(
        Response.json({
          requestId,
          operationId: 'a'.repeat(64),
          targetKind: 'audio',
          targetId: 'wrong-target',
          desiredState: true,
          revision: 9,
          notifications: 'not_sent',
        }),
      )
    },
  })

  return Effect.gen(function* () {
    const save = yield* SaveMembership.implementation
    const result = yield* save(args)
    expect(result._tag).toBe('FailedSaveMembership')
    expect(result).toMatchObject({
      mutationId: requestId,
      unauthorized: false,
      conflicted: false,
    })
    expect(requests).toEqual([
      {
        url: '/api/favorites',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId, expectedRevision: 8, audioId: target.id }),
        },
      },
    ])
  }).pipe(Effect.provideService(MembershipHttp, http), Effect.scoped, Effect.runPromise)
})

it('a valid receipt carries the actual revision instead of inventing a local one', () => {
  const http = MembershipHttp.of({
    requestId: Effect.succeed(requestId),
    request: () =>
      Effect.succeed(
        Response.json({
          requestId,
          operationId: 'b'.repeat(64),
          targetKind: 'audio',
          targetId: target.id,
          desiredState: true,
          revision: 9,
          notifications: 'not_sent',
        }),
      ),
  })

  return Effect.gen(function* () {
    const save = yield* SaveMembership.implementation
    const result = yield* save(args)
    expect(result._tag).toBe('SucceededSaveMembership')
    expect(result).toMatchObject({ revision: 9 })
  }).pipe(Effect.provideService(MembershipHttp, http), Effect.scoped, Effect.runPromise)
})
