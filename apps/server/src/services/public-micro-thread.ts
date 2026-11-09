/* oxlint-disable anti-slop-effect/no-manual-tagged-construction, anti-slop-effect/no-manual-tag-comparison -- The parser-owned recursive block union has no generated constructors/matchers. */
import { type RichContentBlock, RichContentDocument } from '@gbfm/rich-content/schema'
import { parseRichContent, type UnresolvedBlock } from '@gbfm/rich-content/source'
import { sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { Database } from '@/db/layer'
import { DatabaseError, getErrorMessage, NotFoundError } from '@/errors'
import { createPaginationMetadata } from '@/lib/pagination'

const SourceNode = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.NullOr(Schema.String),
  parentPostId: Schema.NullOr(Schema.String),
  rootPostId: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  content: Schema.NullOr(Schema.String),
  unsafeSource: Schema.Number,
  pageOrder: Schema.NullOr(Schema.Number),
})

const Snapshot = Schema.Struct({
  failure: Schema.NullOr(Schema.Literals(['missing', 'limit'])),
  total: Schema.Number,
  rootId: Schema.NullOr(Schema.String),
  focusId: Schema.NullOr(Schema.String),
  nodes: Schema.String,
})

const unavailable = () =>
  new DatabaseError({
    message: 'Public thread exceeds safe read limits.',
    operation: 'public_thread_projection',
    table: 'posts',
  })

const missing = () => new NotFoundError({ message: 'Thread not found', resource: 'post' })

// The parser-owned tagged union has no generated constructors. Never retain an
// unresolved reference's ID, URL, blurb, attributes, or Unsupported.source.
const proseBlock = (block: UnresolvedBlock): RichContentBlock => {
  switch (block._tag) {
    case 'EmbedReference':
      return {
        _tag: 'UnavailableEmbed',
        kind: block.reference._tag === 'ExternalMedia' ? 'media' : 'music',
        label: 'This embed is unavailable in the unhydrated thread view.',
        href: null,
      }
    case 'Unsupported':
      return {
        _tag: 'UnavailableEmbed',
        kind: 'cards',
        label: 'Unsupported content is omitted from the public thread view.',
        href: null,
      }
    case 'Table':
      // The shared parser caps table dimensions without a diagnostic. Do not
      // misrepresent its truncated rows as a complete source table.
      return {
        _tag: 'UnavailableEmbed',
        kind: 'cards',
        label: 'Tables are omitted from the public thread view.',
        href: null,
      }
    case 'Quote':
    case 'CardGroup':
      return { _tag: block._tag, children: block.children.map(proseBlock) }
    case 'List':
      return {
        _tag: 'List',
        ordered: block.ordered,
        start: block.start,
        items: block.items.map((item) => ({
          checked: item.checked,
          children: item.children.map(proseBlock),
        })),
      }
    default:
      return block
  }
}

/**
 * Anonymous source-prose thread read shared by application consumers. Embeds are
 * explicitly unhydrated, never resolved; this is not a full rich-embed page.
 * A hidden ancestor prunes its entire subtree before totals and paging.
 * Closure, counts, page and selected source come from one SQLite read snapshot.
 * Limits: depth 8, 500 visible nodes, 100KiB/source and 256KiB/result.
 */
export const getPublicMicroThreadEffect = Effect.fn('post.getPublicMicroThread')(function* (
  slug: string,
  { limit, offset }: { limit: number; offset: number },
) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10_000 ||
    !slug ||
    slug.length > 200
  )
    return yield* unavailable()
  const db = yield* Database

  // Every occurrence uses the same alias and anonymous policy. This is one
  // statement, not an authorization check followed by independently mutable reads.
  const visible = sql`p.type = 'micro' AND p.draft = 0 AND NOT EXISTS (
    SELECT 1 FROM post_creators pc JOIN user u ON u.id = pc.creatorId
    WHERE pc.postId = p.id AND u.banned = 1
  )`

  const unsafeSource = sql`coalesce(length(CAST(p.content AS BLOB)), 0) > 102400
    OR instr(CAST(p.content AS BLOB), x'00') > 0
    OR coalesce(length(CAST(p.title AS BLOB)), 0) > 102400`

  const rows = yield* Effect.tryPromise({
    try: () =>
      db.all(sql`
      WITH RECURSIVE
      focus AS (
        SELECT p.id, p.parent_post_id, p.root_post_id FROM posts p
        WHERE p.slug = ${slug} AND ${visible}
        ORDER BY p.createdAt, p.id LIMIT 1
      ),
      ancestors(id, parent_post_id, root_post_id, distance) AS (
        SELECT id, parent_post_id, root_post_id, 0 FROM focus
        UNION ALL
        SELECT p.id, p.parent_post_id, p.root_post_id, a.distance + 1
        FROM posts p JOIN ancestors a ON p.id = a.parent_post_id
        WHERE a.distance < 9 AND ${visible}
      ),
      root AS (
        SELECT id FROM ancestors WHERE parent_post_id IS NULL AND root_post_id IS NULL
        AND id = (SELECT coalesce(root_post_id, id) FROM focus)
      ),
      reachable(id, depth) AS (
        SELECT id, 0 FROM root
        UNION ALL
        SELECT p.id, r.depth + 1 FROM posts p JOIN reachable r ON p.parent_post_id = r.id
        WHERE r.depth < 9 AND p.root_post_id = (SELECT id FROM root) AND ${visible}
        LIMIT 501
      ),
      page AS (
        SELECT p.id, row_number() OVER (ORDER BY p.createdAt, p.id) AS ordinal
        FROM posts p JOIN reachable r ON r.id = p.id WHERE r.depth > 0
        ORDER BY p.createdAt, p.id LIMIT ${limit} OFFSET ${offset}
      ),
      guard AS (
        SELECT CASE
          WHEN EXISTS (SELECT 1 FROM ancestors WHERE distance > 8)
            OR (SELECT count(*) FROM reachable) > 500
            OR EXISTS (SELECT 1 FROM reachable WHERE depth > 8) THEN 'limit'
          WHEN NOT EXISTS (SELECT 1 FROM root)
            OR NOT EXISTS (SELECT 1 FROM reachable WHERE id = (SELECT id FROM focus)) THEN 'missing'
          ELSE NULL END AS failure
      )
      SELECT failure, (SELECT count(*) FROM reachable WHERE depth > 0) AS total,
        (SELECT id FROM root) AS rootId, (SELECT id FROM focus) AS focusId,
        (SELECT json_group_array(json_object(
          'id', p.id, 'slug', p.slug,
          'title', CASE WHEN ${unsafeSource} THEN NULL ELSE p.title END,
          'parentPostId', p.parent_post_id, 'rootPostId', p.root_post_id,
          'createdAt', p.createdAt, 'updatedAt', p.updatedAt,
          'pageOrder', (SELECT ordinal FROM page WHERE id = p.id),
          'content', CASE WHEN ${unsafeSource} THEN NULL ELSE p.content END,
          'unsafeSource', CASE WHEN ${unsafeSource} THEN 1 ELSE 0 END
        )) FROM posts p WHERE guard.failure IS NULL AND (
          p.id IN (SELECT id FROM root) OR p.id IN (SELECT id FROM focus) OR p.id IN (SELECT id FROM page)
        )) AS nodes FROM guard
    `),
    catch: (error) =>
      new DatabaseError({
        message: `Public thread read failed: ${getErrorMessage(error)}`,
        operation: 'select',
        table: 'posts',
      }),
  })

  const [snapshot] = yield* Schema.decodeUnknownEffect(Schema.Array(Snapshot))(rows).pipe(
    Effect.mapError(unavailable),
  )

  if (!snapshot || snapshot.failure === 'limit') return yield* unavailable()

  if (snapshot.failure === 'missing') return yield* missing()

  const sources = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(SourceNode)),
  )(snapshot.nodes).pipe(Effect.mapError(unavailable))

  const projected = new Map<
    string,
    {
      id: string
      slug: string
      title: string | null
      parentPostId: string | null
      rootPostId: string | null
      createdAt: Date
      updatedAt: Date
      body: typeof RichContentDocument.Type
    }
  >()

  let sourceBytes = 0

  for (const row of sources) {
    if (row.unsafeSource) return yield* unavailable()
    const source = row.content ?? ''
    const bytes = new TextEncoder().encode(source).byteLength
    sourceBytes += bytes

    if (bytes > 100 * 1024 || sourceBytes > 256 * 1024) return yield* unavailable()

    const parsed = yield* Effect.try({
      try: () => parseRichContent(source, { publicSourceProse: true }),
      catch: unavailable,
    })

    if (parsed.diagnostics.some((diagnostic) => diagnostic.code === 'document-limit-exceeded'))
      return yield* unavailable()

    const body = yield* Schema.decodeUnknownEffect(RichContentDocument)({
      version: 1,
      blocks: parsed.document.blocks.map(proseBlock),
    }).pipe(Effect.mapError(unavailable))

    projected.set(row.id, {
      id: row.id,
      slug: row.slug,
      title: row.title,
      parentPostId: row.parentPostId,
      rootPostId: row.rootPostId,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      body,
    })
  }

  const root = snapshot.rootId ? projected.get(snapshot.rootId) : undefined
  const focus = snapshot.focusId ? projected.get(snapshot.focusId) : undefined

  if (!root || !focus) return yield* missing()

  // Focus is independently included, so derive the page window from SQL rather
  // than slicing this selected set (it need not contain earlier descendants).
  const page = yield* Effect.forEach(
    sources
      .filter((row) => row.pageOrder !== null)
      .sort((a, b) => (a.pageOrder ?? 0) - (b.pageOrder ?? 0)),
    (row) => {
      const post = projected.get(row.id)

      return post ? Effect.succeed(post) : Effect.fail(missing())
    },
  )

  const result = {
    bodyMode: 'unhydrated' as const,
    root,
    focus,
    posts: page,
    pagination: createPaginationMetadata(snapshot.total, limit, offset),
  }

  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024)
    return yield* unavailable()

  return result
})

/** Explicit public topology and unhydrated structured source-prose projection. */
export type PublicMicroThread = Effect.Success<ReturnType<typeof getPublicMicroThreadEffect>>
