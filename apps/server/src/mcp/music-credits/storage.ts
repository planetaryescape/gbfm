import { sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import type { DatabaseClient } from '../../db/layer'
import { McpToolError } from '../contracts'
import { MusicEditId, MusicRevision } from '../music-edit/commands'
import { musicFactNameKey } from './contract'
import type { FactsTarget } from './projection'

const evidence = {
  sourceLabel: Schema.String,
  sourceUrl: Schema.NullOr(Schema.String),
  evidenceNote: Schema.NullOr(Schema.String),
  assertedById: Schema.NullOr(Schema.String),
  assertedAt: Schema.DateFromMillis,
  createdAt: Schema.DateFromMillis,
}

const StoredCredit = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  trackId: Schema.NullOr(MusicEditId),
  albumId: Schema.NullOr(MusicEditId),
  artistId: Schema.NullOr(MusicEditId),
  creditedName: Schema.String,
  creditedNameKey: Schema.String,
  role: Schema.Literals(['performer', 'instrument', 'producer', 'engineer']),
  instrument: Schema.NullOr(Schema.String),
  instrumentKey: Schema.String,
  participantKey: Schema.String,
  displayOrder: MusicRevision,
  ...evidence,
}).check(
  Schema.makeFilter(
    (row) =>
      row.creditedNameKey === musicFactNameKey(row.creditedName) &&
      row.instrumentKey === (row.instrument === null ? '' : musicFactNameKey(row.instrument)) &&
      row.participantKey ===
        (row.artistId === null ? `name:${row.creditedNameKey}` : `artist:${row.artistId}`),
  ),
)

const StoredAlias = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  artistId: MusicEditId,
  name: Schema.String,
  nameKey: Schema.String,
  ...evidence,
}).check(Schema.makeFilter((row) => row.nameKey === musicFactNameKey(row.name)))

export const factsUnavailable = () =>
  new McpToolError({
    code: 'unavailable',
    message: 'Music facts unavailable; retry the identical write request.',
  })

const missing = () =>
  new McpToolError({ code: 'not_found', message: 'Music facts target not found.' })

/** One statement observes parent name/revision and bounded ordered facts together.
 * No publishedAt predicate: P0's artist/album/track catalogue projection is public.
 */
export const loadCreditSnapshot = Effect.fn('MusicFacts.loadCredits')(function* (
  db: DatabaseClient,
  target: { readonly entityType: 'track' | 'album'; readonly entityId: string },
) {
  const table = sql.identifier(target.entityType === 'track' ? 'music_tracks' : 'music_albums')
  const column = sql.identifier(target.entityType === 'track' ? 'track_id' : 'album_id')

  const raw = yield* Effect.tryPromise({
    try: () =>
      db.get(sql`
    SELECT revision, title AS name, (SELECT json_group_array(json(fact)) FROM (
      SELECT json_object('id',id,'trackId',track_id,'albumId',album_id,'artistId',artist_id,
        'creditedName',credited_name,'creditedNameKey',credited_name_key,'role',role,
        'instrument',instrument,'instrumentKey',instrument_key,'participantKey',participant_key,
        'displayOrder',display_order,'sourceLabel',source_label,'sourceUrl',source_url,
        'evidenceNote',evidence_note,'assertedById',asserted_by_id,'assertedAt',asserted_at,'createdAt',created_at) AS fact
      FROM music_recording_credits WHERE ${column}=${target.entityId}
      ORDER BY display_order,id LIMIT 51
    )) AS rows FROM ${table} WHERE id=${target.entityId}`),
    catch: factsUnavailable,
  })

  if (!raw) return yield* missing()

  return yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      revision: MusicRevision,
      name: Schema.String,
      rows: Schema.fromJsonString(Schema.Array(StoredCredit)),
    }),
  )(raw).pipe(Effect.mapError(factsUnavailable))
})

export const loadAliasSnapshot = Effect.fn('MusicFacts.loadAliases')(function* (
  db: DatabaseClient,
  artistId: string,
) {
  const raw = yield* Effect.tryPromise({
    try: () =>
      db.get(sql`
    SELECT revision,name,(SELECT json_group_array(json(fact)) FROM (
      SELECT json_object('id',id,'artistId',artist_id,'name',name,'nameKey',name_key,
        'sourceLabel',source_label,'sourceUrl',source_url,'evidenceNote',evidence_note,
        'assertedById',asserted_by_id,'assertedAt',asserted_at,'createdAt',created_at) AS fact
      FROM music_artist_aliases WHERE artist_id=${artistId}
      ORDER BY name_key COLLATE BINARY,id COLLATE BINARY LIMIT 51
    )) AS rows FROM music_artists WHERE id=${artistId}`),
    catch: factsUnavailable,
  })

  if (!raw) return yield* missing()

  return yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      revision: MusicRevision,
      name: Schema.String,
      rows: Schema.fromJsonString(Schema.Array(StoredAlias)),
    }),
  )(raw).pipe(Effect.mapError(factsUnavailable))
})

/** Receipt disclosure uses current target existence, never a stale captured principal. */
export const factsTargetExists = (db: DatabaseClient, target: typeof FactsTarget.Type) => {
  const tables = { artist: 'music_artists', album: 'music_albums', track: 'music_tracks' }
  const table = sql.identifier(tables[target.entityType])

  return Effect.tryPromise({
    try: () => db.get(sql`SELECT id FROM ${table} WHERE id=${target.entityId}`),
    catch: factsUnavailable,
  })
}
