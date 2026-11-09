import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from 'effect/http-api'

import { AuthMiddleware } from './middleware/auth'

const shortText = Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(300)))

const notes = Schema.String.pipe(Schema.check(Schema.isMaxLength(20000)))

const sourceUrl = Schema.String.pipe(Schema.check(Schema.isMaxLength(2048)))

/** Owner-observed concurrency token; public projections omit it. */
export const ListeningVersion = Schema.String.check(
  Schema.isPattern(/^revision:[1-9][0-9]{0,15}$/),
  Schema.makeFilter((value) => Number.isSafeInteger(Number(value.slice('revision:'.length)))),
)

/** A user's saved external mix; notes share the mix's publication state. */
export const SavedMix = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  platform: Schema.Literals(['youtube', 'spotify', 'soundcloud', 'mixcloud']),
  embedUrl: Schema.NullOr(Schema.String),
  title: Schema.String,
  notes: Schema.String,
  status: Schema.Literals(['to-listen', 'listening', 'listened']),
  published: Schema.Boolean,
  version: Schema.optionalKey(ListeningVersion),
})

export type SavedMix = typeof SavedMix.Type

/** Named collection metadata, without private membership counts. */
export const ListeningCollection = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  published: Schema.Boolean,
  ownerName: Schema.String,
  version: Schema.optionalKey(ListeningVersion),
})

/** Snapshot candidates; saving them is a separate, explicit operation. */
export const ImportPreview = Schema.Struct({
  items: Schema.Array(Schema.Struct({ url: Schema.String, title: Schema.String })),
  warnings: Schema.Array(Schema.String),
})

/** Private workspace or public collection projection. */
export const ListeningDocument = Schema.Struct({
  mixes: Schema.Array(SavedMix),
  collections: Schema.Array(ListeningCollection),
  memberships: Schema.Array(Schema.Struct({ collectionId: Schema.String, mixId: Schema.String })),
})

export type ListeningDocument = typeof ListeningDocument.Type

/** Bounded, validated bulk capture; URLs are canonicalized by the service. */
export const SaveMixesInput = Schema.Struct({
  items: Schema.Array(Schema.Struct({ url: sourceUrl, title: shortText })).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
})

/** One notes field, explicitly published with its saved mix. */
export const EditMixInput = Schema.Struct({
  expectedVersion: ListeningVersion,
  title: shortText,
  notes,
  status: SavedMix.fields.status,
  published: Schema.Boolean,
})

/** Browser creation retains its explicit public/private switch. MCP creation is private-only. */
export const CreateListeningCollectionInput = Schema.Struct({
  title: shortText,
  description: Schema.String.pipe(Schema.check(Schema.isMaxLength(2000))),
  published: Schema.Boolean,
})

/** Existing collection changes require the version the caller actually observed. */
export const EditCollectionInput = Schema.Struct({
  ...CreateListeningCollectionInput.fields,
  expectedVersion: ListeningVersion,
})

export const ListeningVersionInput = Schema.Struct({ expectedVersion: ListeningVersion })

export const ListeningMembershipInput = Schema.Struct({
  expectedVersion: ListeningVersion,
  included: Schema.Boolean,
})

const success = Schema.Struct({ success: Schema.Boolean })

const errors = [
  HttpApiError.BadRequest,
  HttpApiError.Forbidden,
  HttpApiError.NotFound,
  HttpApiError.Conflict,
  HttpApiError.ServiceUnavailable,
]

/** Multi-user listening library and anonymous, publication-filtered collections. */
export const ListeningGroup = HttpApiGroup.make('listening')
  .add(
    HttpApiEndpoint.get('library', '/api/listening', {
      success: ListeningDocument,
      error: errors,
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.post('preview', '/api/listening/preview', {
      payload: Schema.Struct({ url: sourceUrl }),
      success: ImportPreview,
      error: errors,
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.post('save', '/api/listening/mixes', {
      payload: SaveMixesInput,
      success,
      error: errors,
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.put('editMix', '/api/listening/mixes/:id', {
      params: { id: Schema.String },
      payload: EditMixInput,
      success,
      error: errors,
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.delete('deleteMix', '/api/listening/mixes/:id', {
      params: { id: Schema.String },
      payload: ListeningVersionInput,
      success,
      error: errors,
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.post('createCollection', '/api/listening/collections', {
      payload: CreateListeningCollectionInput,
      success,
      error: errors,
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.put('editCollection', '/api/listening/collections/:id', {
      params: { id: Schema.String },
      payload: EditCollectionInput,
      success,
      error: errors,
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.delete('deleteCollection', '/api/listening/collections/:id', {
      params: { id: Schema.String },
      payload: ListeningVersionInput,
      success,
      error: errors,
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.put('membership', '/api/listening/collections/:id/mixes/:mixId', {
      params: { id: Schema.String, mixId: Schema.String },
      payload: ListeningMembershipInput,
      success,
      error: errors,
    }).middleware(AuthMiddleware),
  )
  .add(
    HttpApiEndpoint.get('publicCollections', '/api/listening/public', {
      success: ListeningDocument,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get('publicCollection', '/api/listening/public/:id', {
      params: { id: Schema.String },
      success: ListeningDocument,
      error: errors,
    }),
  )
