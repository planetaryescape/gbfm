import { Schema } from 'effect'

import { EndpointIdentity } from '../contracts'
import { MusicEditId, MusicRevision } from '../music-edit/commands'
import { MusicVersion } from '../music-edit/version'
import type { JsonValue, OperationOutcome } from '../operations/store'
import { SetArtistAliasesInput, SetRecordingCreditsInput } from './contract'

const credit = SetRecordingCreditsInput.fields.credits.value.fields

const alias = SetArtistAliasesInput.fields.aliases.value.fields

const timestamp = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8_640_000_000_000_000 }))

const attribution = {
  assertedById: Schema.NullOr(Schema.String),
  assertedAt: timestamp,
  createdAt: timestamp,
}

/** Explicit projections never expose comparison keys or source identity internals. */
export const PublicCredit = Schema.Struct({
  ...credit,
  id: Schema.String.check(Schema.isUUID()),
  artistId: Schema.optionalKey(MusicEditId),
  displayOrder: MusicRevision,
})

export const AdminCredit = Schema.Struct({ ...PublicCredit.fields, ...attribution })

export const PublicAlias = Schema.Struct({ ...alias, id: Schema.String.check(Schema.isUUID()) })

export const AdminAlias = Schema.Struct({ ...PublicAlias.fields, ...attribution })

export const FactsTarget = Schema.Struct({
  entityType: Schema.Literals(['track', 'album', 'artist']),
  entityId: MusicEditId,
})

export const FactsPageInput = Schema.Struct({
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
  editable: Schema.optionalKey(Schema.Boolean),
})

export const CreditsReadInput = Schema.Struct({
  ...FactsPageInput.fields,
  target: SetRecordingCreditsInput.fields.target,
})

export const AliasesReadInput = Schema.Struct({ ...FactsPageInput.fields, artistId: MusicEditId })

/** P1 supplies the measured installed transport encoder bound to the admitted RPC ID.
 * No default, guessed ID budget or domain-owned copy of the transport envelope.
 */
export interface MusicFactsWire {
  readonly successBytes: (result: JsonValue) => number
}

const page = Schema.Struct({ limit: Schema.Int, offset: Schema.Int, hasMore: Schema.Boolean })

const complete = {
  endpoint: EndpointIdentity,
  target: FactsTarget,
  status: Schema.Literal('complete'),
  pagination: page,
  expectedVersion: MusicVersion,
}

export const SavedFacts = Schema.Struct({
  collection: Schema.Union([
    Schema.Struct({
      ...complete,
      kind: Schema.Literal('recording_credits'),
      items: Schema.Array(AdminCredit),
    }),
    Schema.Struct({
      ...complete,
      kind: Schema.Literal('artist_aliases'),
      items: Schema.Array(AdminAlias),
    }),
  ]),
  changed: Schema.Boolean,
})

export const MusicFactsWriteResult = Schema.Struct({
  ...SavedFacts.fields,
  status: Schema.Literals(['applied', 'replayed']),
  operationId: Schema.String,
  createdAt: timestamp,
  expiresAt: timestamp,
})

const bytes = (value: JsonValue) => new TextEncoder().encode(JSON.stringify(value)).byteLength

/** IDs/timestamps are preallocated, and these exact projections must be committed. */
export const musicFactsWriteFits = (
  outcome: OperationOutcome,
  saved: typeof SavedFacts.Type,
  now: number,
  wire: MusicFactsWire,
) =>
  bytes({ result: outcome.result, revision: outcome.revision, access: outcome.access }) <=
    64 * 1024 &&
  wire.successBytes(saved.collection) <= 256 * 1024 &&
  wire.successBytes({
    status: 'replayed',
    operationId: 'f'.repeat(64),
    createdAt: now,
    expiresAt: now + 86_400_000,
    ...saved,
  }) <=
    256 * 1024

/** Only a fresh, complete, bounded editable page confers a replacement version. */
export const projectFactsPage = (
  endpoint: typeof EndpointIdentity.Type,
  target: typeof FactsTarget.Type,
  kind: 'recording_credits' | 'artist_aliases',
  items: ReadonlyArray<JsonValue>,
  version: string,
  input: typeof FactsPageInput.Type,
  wire: MusicFactsWire,
) => {
  const limit = input.limit ?? 20
  const offset = input.offset ?? 0
  const base = { endpoint, target, kind }

  if (items.length > 50) return { ...base, status: 'over_limit' as const, reason: 'items' as const }
  const complete = offset === 0 && items.length <= limit

  const metadata = {
    ...base,
    status: complete ? ('complete' as const) : ('partial' as const),
    items: items.slice(offset, offset + limit),
    pagination: { limit, offset, hasMore: offset + limit < items.length },
  }

  const result = complete && input.editable ? { ...metadata, expectedVersion: version } : metadata

  return wire.successBytes(result) <= 256 * 1024
    ? result
    : { ...base, status: 'over_limit' as const, reason: 'bytes' as const }
}
