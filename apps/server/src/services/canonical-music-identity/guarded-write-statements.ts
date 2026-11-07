import { sql, type SQL } from 'drizzle-orm'

import {
  artistNameFanoutCapacity,
  artistNameFanoutStatements,
  artistPrimaryNameAvailable,
} from '@/mcp/music-edit/artist-fanout'
import type { OperationContext } from '@/mcp/operations/store'

import type { WriteFence } from './repository-statements'

const tables = {
  artist: 'music_artists',
  album: 'music_albums',
  track: 'music_tracks',
  playlist: 'music_playlists',
} as const

const databaseNow = sql`CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`

/** Parsed, pinned public values only. No related-entity create, credits, derived
 * artistNames, links or provider payloads. Policy/normalization belongs before
 * this builder: preserve canonical fields unless explicitly selected for change.
 */
export type CanonicalMusicWrite = {
  readonly entityId: string
  readonly expectedRevision: number
} & (
  | {
      readonly entityType: 'artist'
      readonly current: { readonly name: string; readonly imageUrl: string | null }
      readonly desired: { readonly name: string; readonly imageUrl: string | null }
    }
  | {
      readonly entityType: 'album' | 'track'
      readonly current: { readonly title: string; readonly coverImageUrl: string | null }
      readonly desired: { readonly title: string; readonly coverImageUrl: string | null }
    }
  | {
      readonly entityType: 'playlist'
      readonly current: {
        readonly title: string
        readonly description: string | null
        readonly coverImageUrl: string | null
      }
      readonly desired: {
        readonly title: string
        readonly description: string | null
        readonly coverImageUrl: string | null
      }
    }
)

/** Identity exclusion before canonical persistence. Every owned source must have
 * this owner and an unexpired DB-time lease; every unowned alias source must
 * already resolve to the same target. Alias collisions never get overwritten.
 * An empty source fence is deliberately ineligible, not an authority fallback.
 */
export const canonicalSourceWriteGuard = (fence: WriteFence): SQL => {
  const owned = new Set(fence.ownedSources.map((source) => source.sourceKey))
  const guards: Array<SQL> = [sql`${fence.ownedSources.length + fence.aliases.length}>0`]

  for (const source of fence.ownedSources)
    guards.push(sql`EXISTS (
    SELECT 1 FROM music_source_identities WHERE source_key=${source.sourceKey}
      AND state='resolving' AND owner_token=${fence.ownerToken} AND lease_expires_at>${databaseNow})`)

  for (const source of [...fence.ownedSources, ...fence.aliases]) {
    guards.push(sql`NOT EXISTS (SELECT 1 FROM music_source_aliases
      WHERE normalized_url=${source.normalizedUrl} AND source_key<>${source.sourceKey})`)

    if (!owned.has(source.sourceKey))
      guards.push(sql`EXISTS (
      SELECT 1 FROM music_source_identities WHERE source_key=${source.sourceKey}
        AND state='resolved' AND entity_type=${fence.reference.entityType} AND entity_id=${fence.reference.entityId})`)
  }

  return sql.join(
    guards.map((guard) => sql`(${guard})`),
    sql` AND `,
  )
}

/** Pure root CAS and artist-name fanout, usable for prepared metadata or artwork
 * association against its ORIGINAL revision/values. The same physical context
 * must fence all coupled domain statements; this function executes nothing.
 *
 * This does not resolve source claims, persist aliases/links, run providers or
 * cut over legacy writers. dependentFence is valid while the source fence holds;
 * callers completing source claims in the same batch must also prove their
 * actual completion in the final assertion, not reuse a now-cleared lease guard.
 */
export const canonicalMusicWriteStatements = (input: {
  readonly write: CanonicalMusicWrite
  readonly sourceFence: WriteFence
  readonly ctx: OperationContext
  readonly liveGuard: SQL
  readonly now: number
}) => {
  const { write, sourceFence, ctx } = input
  const table = sql.identifier(tables[write.entityType])
  const sourceGuard = canonicalSourceWriteGuard(sourceFence)

  const sameTarget = sql`${sourceFence.reference.entityType}=${write.entityType}
    AND ${sourceFence.reference.entityId}=${write.entityId}`

  const current = Object.entries(write.current)

  const changes = Object.entries(write.desired).filter(([key, value]) =>
    current.some(([currentKey, currentValue]) => key === currentKey && value !== currentValue),
  )

  const changed = changes.length > 0
  const rename = write.entityType === 'artist' && write.current.name !== write.desired.name

  const eligible = sql`(${sameTarget}) AND (${sourceGuard})
    AND ${sql.join(
      current.map(([key, value]) => sql`${sql.identifier(key)} IS ${value}`),
      sql` AND `,
    )}
    ${rename ? sql`AND (${artistNameFanoutCapacity(write.entityId)}) AND (${artistPrimaryNameAvailable(write.entityId, write.desired.name)})` : sql``}`

  const parentWinner = sql`EXISTS (SELECT 1 FROM ${table} WHERE id=${write.entityId}
    AND last_operation_id=${ctx.attemptId} AND revision=${write.expectedRevision + (changed ? 1 : 0)})`

  const dependentFence = sql`(${ctx.fence}) AND (${input.liveGuard}) AND (${parentWinner}) AND (${sourceGuard})`

  const assignments = [
    ...changes.map(([key, value]) => sql`${sql.identifier(key)}=${value}`),
    ...(changed ? [sql`updatedAt=${input.now}`] : []),
    sql`revision=revision+${changed ? 1 : 0}`,
    sql`last_operation_id=${ctx.attemptId}`,
  ]

  const statements = [
    ctx.prepare(sql`UPDATE ${table} SET ${sql.join(assignments, sql`, `)}
    WHERE id=${write.entityId} AND revision=${write.expectedRevision}
      AND (${ctx.fence}) AND (${input.liveGuard}) AND (${eligible})
      ${changed ? sql`AND revision<${Number.MAX_SAFE_INTEGER}` : sql``}`),
  ]

  if (rename)
    statements.push(
      ...artistNameFanoutStatements({
        prepare: ctx.prepare,
        artistId: write.entityId,
        attemptId: ctx.attemptId,
        fence: dependentFence,
      }),
    )

  return {
    statements,
    assertApplied: dependentFence,
    parentWinner,
    dependentFence,
    changed,
    revision: write.expectedRevision + (changed ? 1 : 0),
  }
}
