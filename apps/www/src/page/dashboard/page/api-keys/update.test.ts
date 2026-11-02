import * as Dialog from '@foldkit/ui/dialog'
import { KeyId } from '@gbfm/core/personal-access-keys'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { initialModel, Message } from './model'
import { KeyPage } from './service'
import { update } from './update'

describe('API key management', () => {
  it('opens password confirmation without storing a password and prevents closing during issuance', () => {
    const opened = update(initialModel, Message.PasswordRequested()).model
    expect(opened.passwordDialog.isOpen).toBe(true)
    expect(Object.keys(opened)).not.toContain('password')
    const verifying = update(opened, Message.PasswordVerificationStarted()).model
    expect(
      update(
        verifying,
        Message.GotPasswordDialogMessage({ message: Dialog.Message.RequestedClose() }),
      ).model.passwordDialog.isOpen,
    ).toBe(true)

    const failed = update(
      verifying,
      Message.PasswordVerificationFailed({ message: 'Incorrect password. Try again.' }),
    ).model

    expect(failed.passwordError).toBe('Incorrect password. Try again.')
    expect(failed.verifyingPassword).toBe(false)
    expect(
      update(failed, Message.GotPasswordDialogMessage({ message: Dialog.Message.RequestedClose() }))
        .model.passwordDialog.isOpen,
    ).toBe(true)
    expect(update(failed, Message.PasswordCancelled()).model.passwordDialog.isOpen).toBe(false)
    expect(update(verifying, Message.PasswordCancelled()).model.passwordDialog.isOpen).toBe(true)
  })

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

  it('requires selecting and confirming an owned key before revocation', () => {
    const ready = update(initialModel, Message.Loaded({ page })).model
    expect(update(ready, Message.Revoke()).commands).toBeUndefined()
    const confirmed = update(ready, Message.ConfirmRevoke({ id })).model
    const revoking = update(confirmed, Message.Revoke())
    expect(revoking.commands?.[0]).toMatchObject({
      name: 'PersonalAccessKeys.Revoke',
      args: { id },
    })
    expect(update(revoking.model, Message.Revoke()).commands).toBeUndefined()
    expect(
      update(update(confirmed, Message.CancelRevoke()).model, Message.Revoke()).commands,
    ).toBeUndefined()
  })

  it('refreshes metadata after issuance without carrying the secret', () => {
    const result = update(initialModel, Message.Issued())
    expect(result.commands?.[0]).toMatchObject({
      name: 'PersonalAccessKeys.Load',
      args: { offset: 0 },
    })
    expect(Object.keys(result.model)).not.toContain('secret')
  })
})
