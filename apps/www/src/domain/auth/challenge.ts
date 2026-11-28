import { Schema } from 'effect'

export const Status = Schema.Literals(['verifying', 'ready', 'failed', 'submitting', 'unavailable'])

export type Status = typeof Status.Type

export const Action = Schema.Literals(['newsletter-subscribe', 'account-signup'])
