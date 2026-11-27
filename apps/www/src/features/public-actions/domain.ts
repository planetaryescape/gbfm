import { UiSchema } from '@effect/ui'
import { MembershipRevision } from '@gbfm/api/favorites'
import { Schema } from 'effect'

import { MembershipTarget } from '../../domain/membership'

export {
  acceptsMembership,
  advanceMembershipRevision,
  MembershipEntry,
  MembershipModel,
  MembershipProps,
  MembershipTarget,
  membershipKey,
} from '../../domain/membership'

const correlation = {
  target: MembershipTarget,
  principalId: Schema.String,
  generation: Schema.Number,
  request: Schema.Number,
}

export const MembershipMessage = UiSchema.TaggedEnum({
  ChangedPrincipal: { principalId: Schema.NullOr(Schema.String), principalKnown: Schema.Boolean },
  RequestedMembership: { target: MembershipTarget },
  RequestedToggleMembership: { target: MembershipTarget },
  RequestedRetryMembership: { target: MembershipTarget },
  ChangedMembershipLifecycle: {},
  SucceededLoadMembership: { ...correlation, active: Schema.Boolean, revision: MembershipRevision },
  FailedLoadMembership: { ...correlation, unauthorized: Schema.Boolean },
  SucceededSaveMembership: { ...correlation, active: Schema.Boolean, revision: MembershipRevision },
  FailedSaveMembership: {
    ...correlation,
    unauthorized: Schema.Boolean,
    conflicted: Schema.Boolean,
    mutationId: Schema.String,
  },
})

export const MembershipProviderEvents = UiSchema.TaggedEnum({
  RequestedPrincipalRefresh: {},
})
