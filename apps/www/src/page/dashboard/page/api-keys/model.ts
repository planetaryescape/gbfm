import * as Dialog from '@foldkit/ui/dialog'
import { KeyId } from '@gbfm/core/personal-access-keys'
import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { KeyPage } from './service'

export const Model = Schema.Struct({
  page: Schema.NullOr(KeyPage),
  phase: Schema.Literals(['loading', 'ready', 'revoking']),
  confirming: Schema.NullOr(KeyId),
  error: Schema.NullOr(Schema.String),
  notice: Schema.NullOr(Schema.String),
  passwordDialog: Dialog.Model,
  verifyingPassword: Schema.Boolean,
  passwordError: Schema.NullOr(Schema.String),
})

export type Model = typeof Model.Type

export const initialModel: Model = {
  page: null,
  phase: 'loading',
  confirming: null,
  error: null,
  notice: null,
  passwordDialog: Dialog.init({
    id: 'api-key-password',
    focusSelector: 'input[type="password"]',
    allowedOutsideSelectors: ['com-1password-button', 'com-1password-menu'],
  }),
  verifyingPassword: false,
  passwordError: null,
}

export const Message = defineMessageUnion({
  Refresh: { offset: Schema.Number },
  Loaded: { page: KeyPage },
  Failed: { message: Schema.String },
  Issued: { disclosure: Schema.Literals(['Shown', 'Discarded']) },
  PasswordRequested: {},
  PasswordCancelled: {},
  PasswordVerificationStarted: {},
  PasswordVerificationFailed: { message: Schema.String },
  GotPasswordDialogMessage: { message: Dialog.Message },
  ConfirmRevoke: { id: KeyId },
  CancelRevoke: {},
  Revoke: {},
  Revoked: {},
})

export type Message = typeof Message.Type
