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
})

export type Model = typeof Model.Type

export const initialModel: Model = {
  page: null,
  phase: 'loading',
  confirming: null,
  error: null,
  notice: null,
}

export const Message = defineMessageUnion({
  Refresh: { offset: Schema.Number },
  Loaded: { page: KeyPage },
  Failed: { message: Schema.String },
  Issued: {},
  ConfirmRevoke: { id: KeyId },
  CancelRevoke: {},
  Revoke: {},
  Revoked: {},
})

export type Message = typeof Message.Type
