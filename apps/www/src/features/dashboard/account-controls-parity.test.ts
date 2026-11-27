import { Story } from '@effect/ui/testing'
import { KeyId } from '@gbfm/core/personal-access-keys'
import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { KeyPage } from '../../page/dashboard/page/api-keys/service'
import { ApiKeysMessage, DashboardApiKeysNoDeps, RevokeKey } from './api-keys'
import { DashboardSessionsNoDeps, RevokeSession, SessionsMessage } from './sessions'

const principal = { id: 'owner', name: null, username: null, role: 'creator' }

const id = Schema.decodeUnknownSync(KeyId)('c63400ba-984d-4d4e-91ce-3b1722cc28f2')

const page = Schema.decodeUnknownSync(KeyPage)({
  data: [
    {
      id,
      ownerUserId: 'owner',
      name: 'Writer',
      environment: 'dev',
      scopes: ['posts:read'],
      displayPrefix: 'gbfm_pat_v1_dev_abcdef',
      createdAt: '2026-11-02T10:00:00.000Z',
      expiresAt: '2026-12-02T10:00:00.000Z',
      revokedAt: null,
      lastUsedAt: null,
    },
  ],
  pagination: { total: 1, offset: 0, limit: 20, hasMore: false },
})

const revokedPage = Schema.decodeUnknownSync(KeyPage)({
  ...page,
  data: page.data.map((key) => ({ ...key, revokedAt: '2026-11-26T00:00:00.000Z' })),
})

describe('native API-key management parity', () => {
  it('keeps passwords out of the model and ignores cancellation during verification', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardApiKeysNoDeps, { principal })
          s.send(ApiKeysMessage.RequestedPassword()).expectNone()
          expect(s.model.passwordOpen).toBe(true)
          expect(Object.keys(s.model)).not.toContain('password')
          s.send(ApiKeysMessage.StartedVerification()).expectNone()
          s.send(ApiKeysMessage.CancelledPassword()).expectNone()
          expect(s.model.passwordOpen).toBe(true)
          s.send(
            ApiKeysMessage.FailedVerification({ message: 'Incorrect password. Try again.' }),
          ).expectNone()
          expect(s.model.error).toBe('Incorrect password. Try again.')
          expect(s.model.verifying).toBe(false)
          expect(s.model.passwordOpen).toBe(true)
          s.send(ApiKeysMessage.CancelledPassword()).expectNone()
          expect(s.model.passwordOpen).toBe(false)
        }),
      ),
    ))

  it('requires an observed key and confirmation, locks duplicates and honors cancellation before revocation', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardApiKeysNoDeps, { principal })
          s.send(ApiKeysMessage.ClickedConfirmRevoke()).expectNone()
          s.send(ApiKeysMessage.ClickedRevoke({ id })).expectNone()
          expect(s.model.confirming).toBeNull()
          s.send(ApiKeysMessage.ClickedRefresh({ offset: 0 })).loaded('keys', page)
          s.send(ApiKeysMessage.ClickedRevoke({ id })).expectNone()
          s.send(ApiKeysMessage.ClickedCancelRevoke()).expectNone()
          s.send(ApiKeysMessage.ClickedConfirmRevoke()).expectNone()
          s.send(ApiKeysMessage.ClickedRevoke({ id })).expectNone()
          s.send(ApiKeysMessage.ClickedConfirmRevoke())
          const command = RevokeKey.make({ id })
          s.expectExact(command)
          s.keepPending(command).send(ApiKeysMessage.ClickedConfirmRevoke()).expectExact(command)
          s.resolve(command, ApiKeysMessage.SucceededRevoke()).loaded('keys', revokedPage)
          s.send(ApiKeysMessage.ClickedRevoke({ id })).expectNone()
          expect(s.model.confirming).toBeNull()
        }),
      ),
    ))

  it.each([false, true])(
    'refreshes metadata at offset zero without storing a disclosed secret, discarded=%s',
    (discarded) =>
      Effect.runSync(
        Effect.scoped(
          Effect.gen(function* () {
            const s = yield* Story.make(DashboardApiKeysNoDeps, { principal })
            s.send(ApiKeysMessage.IssuedKey({ discarded })).loaded('keys', page)
            expect(s.model.offset).toBe(0)
            expect(s.model.notice).toBe(
              discarded
                ? 'A key was issued after this confirmation was cleared. Revoke it from the list and create a replacement.'
                : 'Key created. Save the secret below before leaving this page.',
            )
            expect(Object.keys(s.model)).not.toContain('secret')
            expect(s.model.passwordOpen).toBe(false)
          }),
        ),
      ),
  )
})

describe('native session administration parity', () => {
  it('requires revoke-all confirmation and pins the selected account in the command', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardSessionsNoDeps, {})
          const user = { id: 'one', name: 'One', email: 'one@example.test' }
          s.send(SessionsMessage.PickedUser({ user })).loaded('sessions', [])
          s.send(SessionsMessage.ClickedConfirmAll()).expectNone()
          s.send(SessionsMessage.ClickedRevokeAll()).expectNone()
          s.send(SessionsMessage.ClickedCancelAll()).expectNone()
          s.send(SessionsMessage.ClickedConfirmAll()).expectNone()
          s.send(SessionsMessage.ClickedRevokeAll()).expectNone()
          s.send(SessionsMessage.ClickedConfirmAll())
          const revision = s.model.revision
          const command = RevokeSession.make({ userId: user.id, sessionId: null, revision })
          s.expectExact(command)
          s.resolve(command, SessionsMessage.SucceededRevoke({ userId: user.id, revision })).loaded(
            'sessions',
            [],
          )
          expect(s.model.notice).toBe('Session access revoked.')
        }),
      ),
    ))

  it('ignores old-account revoke successes and failures after selecting another account', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardSessionsNoDeps, {})
          s.send(
            SessionsMessage.PickedUser({
              user: { id: 'one', name: 'One', email: 'one@example.test' },
            }),
          ).loaded('sessions', [])
          s.send(
            SessionsMessage.PickedUser({
              user: { id: 'two', name: 'Two', email: 'two@example.test' },
            }),
          ).loaded('sessions', [])
          const current = s.model
          s.send(
            SessionsMessage.FailedRevoke({ userId: 'one', revision: 1, message: 'Old failure' }),
          ).expectNone()
          expect(s.model).toEqual(current)
          s.send(SessionsMessage.SucceededRevoke({ userId: 'one', revision: 1 })).expectNone()
          expect(s.model).toEqual(current)
        }),
      ),
    ))

  it('invalidates a pending revoke when search changes, including if the same account is selected again', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardSessionsNoDeps, {})
          const user = { id: 'one', name: 'One', email: 'one@example.test' }
          s.send(SessionsMessage.PickedUser({ user })).loaded('sessions', [])
          s.send(SessionsMessage.ClickedRevokeAll()).expectNone()
          s.send(SessionsMessage.ClickedConfirmAll())
          const revision = s.model.revision
          const command = RevokeSession.make({ userId: user.id, sessionId: null, revision })
          s.expectExact(command).keepPending(command)
          s.send(SessionsMessage.UpdatedQuery({ value: 'two@example.test' }))
            .expectExact(command)
            .keepPending(command)
          expect(s.model.user).toBeNull()
          expect(s.model.busy).toBe(false)
          s.send(SessionsMessage.PickedUser({ user })).loaded('sessions', [])
          const current = s.model
          s.resolve(command, SessionsMessage.SucceededRevoke({ userId: user.id, revision }))
          expect(s.model).toEqual(current)
          s.send(
            SessionsMessage.FailedRevoke({ userId: user.id, revision, message: 'Old failure' }),
          ).expectNone()
          expect(s.model).toEqual(current)
        }),
      ),
    ))
})
