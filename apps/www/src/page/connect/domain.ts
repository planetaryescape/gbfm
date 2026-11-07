import { EditorialScopes, OAuthClientId } from '@gbfm/core/editorial-mcp'
import { Option, Schema } from 'effect'

export const SignedOAuthQuery = Schema.NonEmptyString.check(Schema.isMaxLength(16384)).pipe(
  Schema.brand('SignedOAuthQuery'),
)

const PendingPayload = Schema.Struct({
  query: SignedOAuthQuery,
  clientId: OAuthClientId,
  scopes: EditorialScopes,
})

export const Continuation = Schema.TaggedUnion({
  Missing: {},
  Rejected: {},
  PendingVerification: PendingPayload.fields,
})

export type PendingContinuation = typeof Continuation.cases.PendingVerification.Type

export const ConsentState = Schema.TaggedUnion({
  Verified: {
    continuation: Continuation.cases.PendingVerification,
    clientName: Schema.String,
    account: Schema.Struct({ name: Schema.String, email: Schema.String }),
  },
  LoginRequired: {
    continuation: Continuation.cases.PendingVerification,
    clientName: Schema.String,
  },
  Failed: { status: Schema.Number },
})

export const ProviderOutcome = Schema.TaggedUnion({
  Redirect: { location: Schema.String, cookies: Schema.Array(Schema.String) },
  Rejected: { status: Schema.Number },
})

export const parseContinuation = (params: URLSearchParams): typeof Continuation.Type => {
  if (!params.has('sig')) return Continuation.cases.Missing.make({})
  const names = new Set(params.getAll('ba_param'))

  if (!params.get('sig') || !params.get('exp') || !names.size)
    return Continuation.cases.Rejected.make({})
  const signed = new URLSearchParams()

  for (const [key, value] of params)
    if (key === 'sig' || key === 'ba_param' || names.has(key)) signed.append(key, value)

  const pending = Option.getOrNull(
    Schema.decodeUnknownOption(PendingPayload)({
      query: signed.toString(),
      clientId: signed.get('client_id'),
      scopes: signed.get('scope')?.split(' ').filter(Boolean),
    }),
  )

  return pending
    ? Continuation.cases.PendingVerification.make(pending)
    : Continuation.cases.Rejected.make({})
}
