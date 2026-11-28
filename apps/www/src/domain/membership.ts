import { MembershipRevision } from '@gbfm/api/favorites'
import { Schema } from 'effect'

export const MembershipTarget = Schema.Struct({
  kind: Schema.Literals(['audio', 'show']),
  id: Schema.String,
})

export type MembershipTarget = typeof MembershipTarget.Type

export const MembershipEntry = Schema.Struct({
  target: MembershipTarget,
  status: Schema.Literals(['loading', 'anonymous', 'active', 'inactive', 'unavailable']),
  busy: Schema.Boolean,
  revision: Schema.NullOr(MembershipRevision),
  request: Schema.Number,
  mutationId: Schema.NullOr(Schema.String),
  notice: Schema.NullOr(Schema.String),
})

export type MembershipEntry = typeof MembershipEntry.Type

export const MembershipModel = Schema.Struct({
  principalId: Schema.NullOr(Schema.String),
  principalKnown: Schema.Boolean,
  generation: Schema.Number,
  revision: Schema.NullOr(MembershipRevision),
  entries: Schema.Record(Schema.String, MembershipEntry),
})

export type MembershipModel = typeof MembershipModel.Type

export const MembershipProps = Schema.Struct({
  principalId: Schema.NullOr(Schema.String),
  principalKnown: Schema.Boolean,
  lifecycle: Schema.optional(
    Schema.Struct({
      navigationId: Schema.Number,
      pending: Schema.Boolean,
    }),
  ),
})

export const membershipKey = (target: MembershipTarget) => `${target.kind}:${target.id}`

export const acceptsMembership = (
  model: MembershipModel,
  message: { target: MembershipTarget; principalId: string; generation: number; request: number },
) =>
  model.principalId === message.principalId &&
  model.generation === message.generation &&
  model.entries[membershipKey(message.target)]?.request === message.request &&
  model.entries[membershipKey(message.target)]?.busy

export const advanceMembershipRevision = (
  entries: MembershipModel['entries'],
  revision: number,
): MembershipModel['entries'] =>
  Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [
      key,
      entry.revision !== null && entry.mutationId === null && !entry.busy
        ? { ...entry, revision }
        : entry,
    ]),
  )
