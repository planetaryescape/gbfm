import { SavedMix, ListeningCollection, ListeningVersion } from '@gbfm/api/listening'
import { Schema } from 'effect'

export { ListeningVersion } from '@gbfm/api/listening'

/** Owner-only pages never accept an owner ID or disclose global totals. */
export const ListeningPageInput = Schema.Struct({
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
})

const pagination = Schema.Struct({ limit: Schema.Int, offset: Schema.Int, hasMore: Schema.Boolean })

/** Private notes are returned only with listening:read authority. */
export const SavedMixPage = Schema.Struct({
  mixes: Schema.Array(Schema.Struct({ ...SavedMix.fields, version: ListeningVersion })),
  pagination,
})

/** Collection metadata excludes membership counts and other owners' records. */
export const CollectionPage = Schema.Struct({
  collections: Schema.Array(
    Schema.Struct({ ...ListeningCollection.fields, version: ListeningVersion }),
  ),
  pagination,
})

const requestId = Schema.String.check(Schema.isUUID(4))

const id = Schema.NonEmptyString.check(Schema.isMaxLength(200))

const expectedVersion = ListeningVersion

/** Receipts retain only stable identity/version, never private text or publication controls. */
export const SavedMixCommandResult = Schema.Struct({ mixId: id, version: ListeningVersion })

export const CollectionCommandResult = Schema.Struct({
  collectionId: id,
  version: ListeningVersion,
})

const title = Schema.NonEmptyString.check(
  Schema.isMaxLength(300),
  Schema.makeFilter((value) => value.trim().length > 0),
)

/** Save privately through durable receipts; never accepts publication. */
export const SaveMixInput = Schema.Struct({
  requestId,
  url: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
  title,
})

/** Notes edit cannot replace title, status or publication state. */
export const UpdateListeningNotesInput = Schema.Struct({
  requestId,
  mixId: id,
  expectedVersion,
  notes: Schema.String.check(Schema.isMaxLength(20_000)),
})

/** Status edit cannot overwrite notes or publish a saved mix. */
export const SetListeningStatusInput = Schema.Struct({
  requestId,
  mixId: id,
  expectedVersion,
  status: SavedMix.fields.status,
})

/** New collections are private, with no publication parameter. */
export const CreateCollectionInput = Schema.Struct({
  requestId,
  title,
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2000))),
})

/** A collection edit needs an atomic collection revision check. */
export const UpdateCollectionInput = Schema.Struct({
  requestId,
  collectionId: id,
  expectedVersion,
  title: Schema.optionalKey(title),
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2000))),
}).check(Schema.makeFilter((input) => input.title !== undefined || input.description !== undefined))

/** Desired membership, both targets owned/private, guarded by collection revision. */
export const SetCollectionMembershipInput = Schema.Struct({
  requestId,
  collectionId: id,
  mixId: id,
  expectedVersion,
  included: Schema.Boolean,
})
