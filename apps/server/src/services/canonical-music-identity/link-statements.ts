import { sql, type SQL } from 'drizzle-orm'

import type { MusicPlatform } from '@/db/music-entity.schema'
import { musicParentCas, musicParentWinner } from '@/mcp/music-edit/statements'
import type { OperationContext } from '@/mcp/operations/store'

import type { ParsedMusicSource } from './music-source'

export interface LinkTarget {
  readonly entityType: 'artist' | 'album' | 'track'
  readonly entityId: string
}

export interface ObservedMusicLink {
  readonly id: string
  readonly platform: MusicPlatform
  readonly url: string
  readonly status: string
}

export interface PreparedMusicLink {
  readonly platform: MusicPlatform
  readonly url: string
  readonly source: ParsedMusicSource
}

const databaseNow = sql`CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`

const aliasExclusion = (source: ParsedMusicSource) => sql`NOT EXISTS (
  SELECT 1 FROM music_source_aliases WHERE normalized_url=${source.normalizedUrl}
  AND source_key<>${source.sourceKey})`

const resolvedFor = (target: LinkTarget, source: ParsedMusicSource) => sql`EXISTS (
  SELECT 1 FROM music_source_identities WHERE source_key=${source.sourceKey}
  AND state='resolved' AND entity_type=${target.entityType} AND entity_id=${target.entityId})`

const sourceAvailable = (target: LinkTarget, source: ParsedMusicSource) =>
  sql`(${aliasExclusion(source)}) AND NOT EXISTS (
    SELECT 1 FROM music_source_identities WHERE source_key=${source.sourceKey}
    AND NOT ((state='resolved' AND entity_type=${target.entityType} AND entity_id=${target.entityId})
      OR (state='resolving' AND lease_expires_at<=${databaseNow})))
    AND NOT EXISTS (SELECT 1 FROM music_source_identities WHERE source_key<>${source.sourceKey}
      AND (canonical_url=${source.canonicalUrl}
        ${source.externalId === null ? sql`` : sql`OR (platform=${source.platform} AND source_entity_type=${source.sourceEntityType} AND external_id=${source.externalId})`}))`

/** Bounded full link-set observation closes races with legacy writers that do not bump revisions. */
const observedLinks = (target: LinkTarget, links: ReadonlyArray<ObservedMusicLink>) => sql`
  (SELECT COUNT(*) FROM music_entity_links WHERE entity_type=${target.entityType}
    AND entityId=${target.entityId})=${links.length}
  ${sql.join(
    links.map(
      (link) => sql`AND EXISTS (SELECT 1 FROM music_entity_links WHERE id=${link.id}
        AND entity_type=${target.entityType} AND entityId=${target.entityId}
        AND platform=${link.platform} AND url=${link.url} AND status=${link.status})`,
    ),
    sql` `,
  )}`

/** Pure U1 plan, called only inside the shared receipt executor after authorized replay lookup.
 * No network, lease claim, raw repository writer or second receipt ledger runs outside this plan.
 */
export const musicLinkStatements = (input: {
  readonly context: OperationContext
  readonly target: LinkTarget
  readonly expectedRevision: number
  readonly liveGuard: SQL
  readonly now: number
  readonly observed: ReadonlyArray<ObservedMusicLink>
  readonly attach: ReadonlyArray<PreparedMusicLink>
  readonly release:
    | {
        readonly link: ObservedMusicLink
        readonly source: ParsedMusicSource | undefined
        readonly action: 'reject' | 'remove'
        /** Planner parsed all other verified links; shared source ownership must survive. */
        readonly keepIdentity: boolean
      }
    | undefined
}) => {
  const { context: ctx, target, liveGuard } = input
  const sources = input.attach.map((link) => sourceAvailable(target, link.source))

  const eligibility = sql`(${observedLinks(target, input.observed)})
    ${
      sources.length
        ? sql`AND (${sql.join(
            sources.map((guard) => sql`(${guard})`),
            sql` AND `,
          )})`
        : sql``
    }
    ${sql.join(
      input.attach.map(
        (link) => sql`AND NOT EXISTS (SELECT 1 FROM music_entity_links
          WHERE entity_type=${target.entityType} AND entityId=${target.entityId}
          AND platform=${link.platform} AND (status<>'verified' OR url<>${link.url}))`,
      ),
      sql` `,
    )}`

  const winner = sql`(${ctx.fence}) AND (${liveGuard}) AND (${musicParentWinner(target, ctx.attemptId)})`

  const statements = [
    ctx.prepare(
      musicParentCas({
        target,
        expectedRevision: input.expectedRevision,
        changed: true,
        attemptId: ctx.attemptId,
        fence: ctx.fence,
        liveGuard,
        eligibility,
        assignments: [sql`updatedAt=${input.now}`],
      }),
    ),
  ]

  for (const link of input.attach) {
    const source = link.source
    const available = sourceAvailable(target, source)
    const guard = sql`(${winner}) AND (${available})`

    const owned = sql`EXISTS (SELECT 1 FROM music_source_identities
      WHERE source_key=${source.sourceKey} AND state='resolving'
      AND owner_token=${ctx.attemptId} AND lease_expires_at>${databaseNow})`

    statements.push(
      ctx.prepare(sql`INSERT INTO music_source_identities
        (source_key,platform,source_entity_type,external_id,canonical_url,state,owner_token,
          lease_expires_at,created_at,updated_at)
        SELECT ${source.sourceKey},${source.platform},${source.sourceEntityType},${source.externalId},
          ${source.canonicalUrl},'resolving',${ctx.attemptId},${databaseNow}+5000,${input.now},${input.now}
        WHERE (${guard}) ON CONFLICT(source_key) DO UPDATE SET owner_token=${ctx.attemptId},
          lease_expires_at=${databaseNow}+5000,updated_at=${input.now}
        WHERE state='resolving' AND lease_expires_at<=${databaseNow} AND (${guard})`),
      ctx.prepare(sql`UPDATE music_source_identities SET state='resolved',
        entity_type=${target.entityType},entity_id=${target.entityId},owner_token=NULL,
        lease_expires_at=NULL,resolved_at=${input.now},last_scraped_at=${input.now},updated_at=${input.now}
        WHERE source_key=${source.sourceKey} AND (${winner}) AND (${owned})
          AND (${aliasExclusion(source)})`),
    )

    const resolved = sql`(${winner}) AND (${resolvedFor(target, source)}) AND (${aliasExclusion(source)})`
    statements.push(
      ctx.prepare(sql`INSERT INTO music_source_aliases (normalized_url,source_key,first_seen_at,last_seen_at)
        SELECT ${source.normalizedUrl},${source.sourceKey},${input.now},${input.now}
        WHERE (${resolved}) ON CONFLICT(normalized_url) DO UPDATE SET last_seen_at=${input.now}
        WHERE source_key=${source.sourceKey} AND (${resolved})`),
      ctx.prepare(sql`INSERT INTO music_entity_links
        (id,entity_type,entityId,platform,url,status,scrapedAt,verifiedAt,metadata,createdAt,updatedAt)
        SELECT lower(hex(randomblob(16))),${target.entityType},${target.entityId},${link.platform},
          ${link.url},'verified',${input.now},${input.now},
          ${JSON.stringify({ discoveredBy: 'manual', confidence: 'exact_source' })},${input.now},${input.now}
        WHERE (${resolved}) ON CONFLICT(entity_type,entityId,platform) DO UPDATE
        SET scrapedAt=${input.now},updatedAt=${input.now}
        WHERE status='verified' AND url=${link.url} AND (${resolved})`),
    )
  }

  if (input.release) {
    const { link, source, action, keepIdentity } = input.release

    if (source && !keepIdentity) {
      statements.push(
        ctx.prepare(sql`DELETE FROM music_source_identities WHERE source_key=${source.sourceKey}
          AND state='resolved' AND entity_type=${target.entityType} AND entity_id=${target.entityId}
          AND (${winner}) AND (${aliasExclusion(source)})`),
      )
    }

    statements.push(
      ctx.prepare(
        action === 'remove'
          ? sql`DELETE FROM music_entity_links WHERE id=${link.id}
            AND entity_type=${target.entityType} AND entityId=${target.entityId}
            AND (${winner})`
          : sql`UPDATE music_entity_links SET status='rejected',updatedAt=${input.now}
            WHERE id=${link.id} AND entity_type=${target.entityType} AND entityId=${target.entityId}
            AND (${winner})`,
      ),
    )
  }

  const attached = input.attach.map(
    (link) => sql`(${resolvedFor(target, link.source)}) AND EXISTS (
      SELECT 1 FROM music_source_aliases WHERE normalized_url=${link.source.normalizedUrl}
        AND source_key=${link.source.sourceKey}) AND EXISTS (SELECT 1 FROM music_entity_links
      WHERE entity_type=${target.entityType} AND entityId=${target.entityId}
        AND platform=${link.platform} AND url=${link.url} AND status='verified')`,
  )

  const released = input.release
    ? input.release.action === 'remove'
      ? sql`NOT EXISTS (SELECT 1 FROM music_entity_links WHERE id=${input.release.link.id})`
      : sql`EXISTS (SELECT 1 FROM music_entity_links WHERE id=${input.release.link.id} AND status='rejected')`
    : sql`1`

  return {
    statements,
    assertApplied: sql`(${winner}) AND (${released})
      ${
        attached.length
          ? sql`AND (${sql.join(
              attached.map((guard) => sql`(${guard})`),
              sql` AND `,
            )})`
          : sql``
      }`,
  }
}
