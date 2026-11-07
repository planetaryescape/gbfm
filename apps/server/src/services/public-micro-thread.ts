/* oxlint-disable anti-slop-effect/no-manual-tagged-construction, anti-slop-effect/no-manual-tag-comparison -- The parser-owned recursive block union has no generated constructors/matchers. */
import { type RichContentBlock, RichContentDocument } from '@gbfm/rich-content/schema'
import { parseRichContent, type UnresolvedBlock } from '@gbfm/rich-content/source'
import { and, asc, eq, inArray, notInArray, type SQL, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { DatabaseError, getErrorMessage, NotFoundError } from '@/errors'
import { createPaginationMetadata } from '@/lib/pagination'

const fields = {
  id: postsTable.id,
  slug: postsTable.slug,
  title: postsTable.title,
  parentPostId: postsTable.parentPostId,
  rootPostId: postsTable.rootPostId,
  createdAt: postsTable.createdAt,
  updatedAt: postsTable.updatedAt,
}

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
 * Limits: depth 8, 500 visible nodes, batches 50, 100KiB/source and 256KiB/result.
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

  const bannedPosts = db
    .select({ id: postCreators.postId })
    .from(postCreators)
    .innerJoin(user, eq(user.id, postCreators.creatorId))
    .where(eq(user.banned, true))

  const visible = and(
    eq(postsTable.type, 'micro'),
    eq(postsTable.draft, false),
    notInArray(postsTable.id, bannedPosts),
  )

  const read = (where: SQL | undefined, maximum: number) =>
    Effect.tryPromise({
      try: () =>
        db
          .select(fields)
          .from(postsTable)
          .where(and(visible, where))
          .orderBy(asc(postsTable.createdAt), asc(postsTable.id))
          .limit(maximum),
      catch: (error) =>
        new DatabaseError({
          message: `Public thread read failed: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

  const [focus] = yield* read(eq(postsTable.slug, slug), 1)

  if (!focus) return yield* missing()
  let root = focus
  const ancestors = new Set([focus.id])

  while (root.parentPostId !== null) {
    if (ancestors.size > 8) return yield* unavailable()
    const [parent] = yield* read(eq(postsTable.id, root.parentPostId), 1)

    if (!parent || ancestors.has(parent.id)) return yield* missing()
    ancestors.add(parent.id)
    root = parent
  }

  if (root.id !== (focus.rootPostId ?? focus.id) || root.rootPostId !== null)
    return yield* missing()

  const reachable = new Map([[root.id, root]])
  let frontier = [root.id]

  for (let depth = 1; frontier.length > 0; depth++) {
    const next: Array<string> = []

    for (let start = 0; start < frontier.length; start += 50) {
      const children = yield* read(
        and(
          inArray(postsTable.parentPostId, frontier.slice(start, start + 50)),
          eq(postsTable.rootPostId, root.id),
        ),
        501 - reachable.size,
      )

      if (children.length > 0 && depth > 8) return yield* unavailable()

      for (const child of children) {
        if (reachable.has(child.id)) return yield* missing()
        reachable.set(child.id, child)

        if (reachable.size > 500) return yield* unavailable()
        next.push(child.id)
      }
    }

    frontier = next
  }

  if (!reachable.has(focus.id)) return yield* missing()

  const descendants = [...reachable.values()]
    .filter((row) => row.id !== root.id)
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : Number(a.id !== b.id)),
    )

  const page = descendants.slice(offset, offset + limit)
  const selected = [...new Map([root, focus, ...page].map((row) => [row.id, row])).values()]
  const bodies = new Map<string, typeof RichContentDocument.Type>()
  let sourceBytes = 0

  for (let start = 0; start < selected.length; start += 50) {
    const sources = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            id: postsTable.id,
            content: sql<string | null>`substr(${postsTable.content}, 1, 102401)`,
          })
          .from(postsTable)
          .where(
            and(
              visible,
              inArray(
                postsTable.id,
                selected.slice(start, start + 50).map((row) => row.id),
              ),
            ),
          ),
      catch: (error) =>
        new DatabaseError({
          message: `Public thread source read failed: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    })

    for (const row of sources) {
      const source = row.content ?? ''
      const bytes = new TextEncoder().encode(source).byteLength
      sourceBytes += bytes

      if (bytes > 100 * 1024 || sourceBytes > 256 * 1024) return yield* unavailable()
      const parsed = yield* Effect.try({ try: () => parseRichContent(source), catch: unavailable })

      if (parsed.diagnostics.some((diagnostic) => diagnostic.code === 'document-limit-exceeded'))
        return yield* unavailable()

      const body = yield* Schema.decodeUnknownEffect(RichContentDocument)({
        version: 1,
        blocks: parsed.document.blocks.map(proseBlock),
      }).pipe(Effect.mapError(unavailable))

      bodies.set(row.id, body)
    }
  }

  const project = (row: typeof root) => {
    const body = bodies.get(row.id)

    return body ? Effect.succeed({ ...row, body }) : Effect.fail(missing())
  }

  const result = {
    bodyMode: 'unhydrated' as const,
    root: yield* project(root),
    focus: yield* project(focus),
    posts: yield* Effect.forEach(page, project),
    pagination: createPaginationMetadata(descendants.length, limit, offset),
  }

  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024)
    return yield* unavailable()

  return result
})

/** Explicit public topology and unhydrated structured source-prose projection. */
export type PublicMicroThread = Effect.Success<ReturnType<typeof getPublicMicroThreadEffect>>
