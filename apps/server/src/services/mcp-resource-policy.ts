import { McpResourceUrl, McpScope } from '@gbfm/core/editorial-mcp'
import { and, eq, isNull } from 'drizzle-orm'
import { DateTime, Effect, Schema } from 'effect'

import { Database } from '@/db/layer'
import { oauthResource } from '@/db/oauth.schema'

const Text = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(500))

const Version = Schema.Int.check(Schema.isGreaterThan(0))

const Scopes = Schema.Array(McpScope).check(
  Schema.makeFilter(
    (scopes) =>
      new Set(scopes).size === scopes.length &&
      (!scopes.includes('drafts:write') || scopes.includes('posts:read')),
  ),
)

export const PolicyTarget = Schema.Struct({
  environment: Schema.Literals(['local', 'preview', 'production']),
  databaseId: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  resourceUrl: McpResourceUrl,
})

export type PolicyTarget = typeof PolicyTarget.Type

export const PolicyState = Schema.Struct({ version: Version, scopes: Scopes })

export const PolicyPlan = Schema.Struct({
  operationId: Schema.String.check(Schema.isUUID(4)),
  target: PolicyTarget,
  actor: Text,
  reason: Text,
  approval: Text,
  before: PolicyState,
  after: PolicyState,
}).check(Schema.makeFilter((plan) => plan.after.version === plan.before.version + 1))

export type PolicyPlan = typeof PolicyPlan.Type

const Receipt = Schema.Struct({ ...PolicyPlan.fields, appliedAt: Schema.String })

const History = Schema.Array(Receipt).check(Schema.isMaxLength(50))

const Metadata = Schema.Record(Schema.String, Schema.Unknown)

export class McpPolicyError extends Schema.TaggedError<McpPolicyError>()('McpPolicyError', {
  reason: Schema.Literals([
    'unavailable',
    'invalid_policy',
    'conflict',
    'invalid_plan',
    'disabled',
    'target_mismatch',
    'history_full',
  ]),
}) {}

const read = Effect.fn('McpResourcePolicy.read')(function* (target: PolicyTarget) {
  const db = yield* Database

  const [raw] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          allowedScopes: oauthResource.allowedScopes,
          policyVersion: oauthResource.policyVersion,
          disabled: oauthResource.disabled,
          metadata: oauthResource.metadata,
        })
        .from(oauthResource)
        .where(eq(oauthResource.identifier, target.resourceUrl))
        .limit(1),
    catch: () => new McpPolicyError({ reason: 'unavailable' }),
  })

  const row = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      allowedScopes: Schema.String.check(Schema.isMaxLength(8192)),
      policyVersion: Version,
      disabled: Schema.Boolean,
      metadata: Schema.NullOr(Schema.String.check(Schema.isMaxLength(262144))),
    }),
  )(raw).pipe(Effect.mapError(() => new McpPolicyError({ reason: 'invalid_policy' })))

  const scopes = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Scopes))(
    row.allowedScopes,
  ).pipe(Effect.mapError(() => new McpPolicyError({ reason: 'invalid_policy' })))

  const metadata =
    (row.metadata === null
      ? null
      : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.NullOr(Metadata)))(
          row.metadata,
        ).pipe(Effect.mapError(() => new McpPolicyError({ reason: 'invalid_policy' })))) ?? {}

  const history = yield* Schema.decodeUnknownEffect(History)(metadata.mcpPolicyHistory ?? []).pipe(
    Effect.mapError(() => new McpPolicyError({ reason: 'invalid_policy' })),
  )

  return { row, metadata, history, state: { version: row.policyVersion, scopes } }
})

export const inspectMcpPolicy = Effect.fn('McpResourcePolicy.inspect')(function* (
  target: PolicyTarget,
) {
  const current = yield* read(target)

  return { target, ...current.state, disabled: current.row.disabled, history: current.history }
})

const sameScopes = (left: ReadonlyArray<McpScope>, right: ReadonlyArray<McpScope>) =>
  left.length === right.length && left.every((scope) => right.includes(scope))

const samePlan = (left: PolicyPlan, right: PolicyPlan) =>
  left.operationId === right.operationId &&
  left.target.environment === right.target.environment &&
  left.target.databaseId === right.target.databaseId &&
  left.target.resourceUrl === right.target.resourceUrl &&
  left.actor === right.actor &&
  left.reason === right.reason &&
  left.approval === right.approval &&
  left.before.version === right.before.version &&
  left.after.version === right.after.version &&
  sameScopes(left.before.scopes, right.before.scopes) &&
  sameScopes(left.after.scopes, right.after.scopes)

export const planMcpPolicy = Effect.fn('McpResourcePolicy.plan')(function* (
  input: Omit<PolicyPlan, 'before' | 'after'> & {
    readonly scopes: ReadonlyArray<McpScope>
    readonly expectedVersion: number
  },
) {
  const current = yield* read(input.target)

  if (current.row.disabled) return yield* new McpPolicyError({ reason: 'disabled' })

  if (current.state.version !== input.expectedVersion)
    return yield* new McpPolicyError({ reason: 'conflict' })

  if (sameScopes(current.state.scopes, input.scopes))
    return yield* new McpPolicyError({ reason: 'invalid_plan' })

  return yield* Schema.decodeUnknownEffect(PolicyPlan)(
    {
      operationId: input.operationId,
      target: input.target,
      actor: input.actor,
      reason: input.reason,
      approval: input.approval,
      before: current.state,
      after: { version: current.state.version + 1, scopes: [...input.scopes].sort() },
    },
    { onExcessProperty: 'error' },
  ).pipe(Effect.mapError(() => new McpPolicyError({ reason: 'invalid_plan' })))
})

export const applyMcpPolicy = Effect.fn('McpResourcePolicy.apply')(function* (
  target: PolicyTarget,
  plan: PolicyPlan,
) {
  if (
    target.environment !== plan.target.environment ||
    target.databaseId !== plan.target.databaseId ||
    target.resourceUrl !== plan.target.resourceUrl
  )
    return yield* new McpPolicyError({ reason: 'target_mismatch' })
  const db = yield* Database
  const current = yield* read(target)
  const previous = current.history.find((receipt) => receipt.operationId === plan.operationId)

  if (previous) {
    if (!samePlan(previous, plan)) return yield* new McpPolicyError({ reason: 'conflict' })

    return { replayed: true, receipt: previous, current: current.state }
  }

  if (current.row.disabled) return yield* new McpPolicyError({ reason: 'disabled' })

  if (current.history.length >= 50) return yield* new McpPolicyError({ reason: 'history_full' })

  if (
    current.state.version !== plan.before.version ||
    !sameScopes(current.state.scopes, plan.before.scopes)
  )
    return yield* new McpPolicyError({ reason: 'conflict' })

  if (sameScopes(plan.before.scopes, plan.after.scopes))
    return yield* new McpPolicyError({ reason: 'invalid_plan' })
  const now = yield* DateTime.now
  const receipt = { ...plan, appliedAt: DateTime.formatIso(now) }

  const metadata = JSON.stringify({
    ...current.metadata,
    mcpPolicyHistory: [...current.history, receipt],
  })

  if (new TextEncoder().encode(metadata).length > 262144)
    return yield* new McpPolicyError({ reason: 'history_full' })

  const changed = yield* Effect.tryPromise({
    try: () =>
      db
        .update(oauthResource)
        .set({
          allowedScopes: JSON.stringify(plan.after.scopes),
          policyVersion: plan.after.version,
          updatedAt: DateTime.toDateUtc(now),
          metadata,
        })
        .where(
          and(
            eq(oauthResource.identifier, target.resourceUrl),
            eq(oauthResource.policyVersion, plan.before.version),
            eq(oauthResource.allowedScopes, current.row.allowedScopes),
            eq(oauthResource.disabled, false),
            current.row.metadata === null
              ? isNull(oauthResource.metadata)
              : eq(oauthResource.metadata, current.row.metadata),
          ),
        )
        .returning({ version: oauthResource.policyVersion }),
    catch: () => new McpPolicyError({ reason: 'unavailable' }),
  })

  if (changed.length !== 1) return yield* new McpPolicyError({ reason: 'conflict' })

  return { replayed: false, receipt, current: plan.after }
})

export const planMcpPolicyRollback = Effect.fn('McpResourcePolicy.rollback')(function* (
  input: Omit<PolicyPlan, 'before' | 'after'> & {
    readonly rollbackOperationId: string
    readonly expectedVersion: number
  },
) {
  const current = yield* read(input.target)
  const receipt = current.history.find((item) => item.operationId === input.rollbackOperationId)

  if (
    !receipt ||
    current.state.version !== receipt.after.version ||
    !sameScopes(current.state.scopes, receipt.after.scopes)
  )
    return yield* new McpPolicyError({ reason: 'conflict' })

  return yield* planMcpPolicy({ ...input, scopes: receipt.before.scopes })
})
