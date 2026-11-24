import { RICH_CONTENT_LIMITS } from '@gbfm/rich-content/limits'
/* oxlint-disable anti-slop-effect/no-manual-tagged-construction, anti-slop-effect/no-manual-tag-comparison -- Recursive rich-content wire unions have no generated constructors or matchers. */
import { type RichContentBlock, MicroEmbedMetadata, SafeUrl } from '@gbfm/rich-content/schema'
import { parseRichContent, type UnresolvedBlock } from '@gbfm/rich-content/source'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { Context, Data, Effect, Layer, Schema } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { publicMicroAncestorQuery } from '@/services/public-micro-ancestry'

export interface RichContentMicroResolver {
  readonly resolveMany: (
    postIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, RichContentBlock>>
}

export const RichContentMicroResolver = Context.Service<RichContentMicroResolver>(
  'RichContentMicroResolver',
)

class MicroEmbedLookupError extends Data.TaggedError('MicroEmbedLookupError')<{
  readonly cause: unknown
}> {}

const MicroRows = Schema.Array(
  Schema.Struct({
    id: Schema.NonEmptyString,
    slug: Schema.NonEmptyString,
    title: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
    content: Schema.NullOr(Schema.String),
    createdAt: Schema.Date,
    name: Schema.NullOr(Schema.String),
    username: Schema.NullOr(Schema.String),
    image: Schema.NullOr(Schema.String),
  }),
)

const isSafeUrl = Schema.is(SafeUrl)

const avatarUrl = (image: string | null) => (image !== null && isSafeUrl(image) ? image : null)

const omitted = (): RichContentBlock => ({
  _tag: 'UnavailableEmbed',
  kind: 'cards',
  label: 'Open the original note to see embedded or unsupported content.',
  href: null,
})

const proseBlock = (block: UnresolvedBlock): RichContentBlock => {
  switch (block._tag) {
    case 'EmbedReference':
    case 'Unsupported':
    case 'Table':
      return omitted()
    case 'Quote':
    case 'CardGroup':
      return { _tag: block._tag, children: block.children.map(proseBlock) }
    case 'List':
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          children: item.children.map(proseBlock),
        })),
      }
    default:
      return block
  }
}

export const RichContentMicroResolverLayer = Layer.effect(
  RichContentMicroResolver,
  Effect.gen(function* () {
    const db = yield* Database

    const resolveMany = Effect.fn('richContent.micro.resolveMany')(function* (
      postIds: ReadonlyArray<string>,
    ) {
      const ids = [...new Set(postIds)]
      const results = new Map<string, RichContentBlock>()

      if (ids.length === 0) return results

      if (ids.length > RICH_CONTENT_LIMITS.microEmbeds) return results

      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({
              id: postsTable.id,
              slug: postsTable.slug,
              title: postsTable.title,
              content: postsTable.content,
              createdAt: postsTable.createdAt,
              name: user.name,
              username: user.username,
              image: user.image,
            })
            .from(postsTable)
            .leftJoin(postCreators, eq(postCreators.postId, postsTable.id))
            .leftJoin(user, eq(user.id, postCreators.creatorId))
            .where(
              and(
                inArray(postsTable.id, ids),
                sql`EXISTS (${publicMicroAncestorQuery(sql`${postsTable.id}`)})`,
                sql`coalesce(length(CAST(${postsTable.content} AS BLOB)), 0) <= ${RICH_CONTENT_LIMITS.microSourceBytes}`,
                sql`coalesce(length(CAST(${postsTable.title} AS BLOB)), 0) <= 2000`,
                sql`instr(CAST(${postsTable.content} AS BLOB), x'00') = 0`,
              ),
            )
            .orderBy(asc(postsTable.id), asc(user.id))
            .limit(RICH_CONTENT_LIMITS.microAuthorRows + 1),
        catch: (cause) => new MicroEmbedLookupError({ cause }),
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(MicroRows)),
        Effect.catch(() =>
          Effect.logWarning('richContent.micro.lookupUnavailable').pipe(Effect.as([])),
        ),
      )

      if (rows.length > RICH_CONTENT_LIMITS.microAuthorRows) return results

      for (const id of ids) {
        const records = rows.filter((row) => row.id === id)
        const row = records[0]

        if (!row) continue

        const parsed = parseRichContent(row.content ?? '', {
          publicSourceProse: true,
          blocks: RICH_CONTENT_LIMITS.microBlocks,
        })

        if (parsed.diagnostics.some((item) => item.code === 'document-limit-exceeded')) continue

        const metadata = yield* Schema.decodeUnknownEffect(MicroEmbedMetadata)({
          postId: row.id,
          slug: row.slug,
          title: row.title,
          createdAt: row.createdAt.toISOString(),
          authors: records.flatMap((author) =>
            author.name === null
              ? []
              : [{ name: author.name, username: author.username, image: avatarUrl(author.image) }],
          ),
        })

        results.set(id, {
          _tag: 'Quote',
          micro: metadata,
          children: [
            ...parsed.document.blocks.map(proseBlock),
            {
              _tag: 'Paragraph',
              children: [
                {
                  _tag: 'Link',
                  href: `/tweet/${encodeURIComponent(row.slug)}`,
                  title: null,
                  children: [{ _tag: 'Text', value: 'View original note on GBFM' }],
                },
              ],
            },
          ],
        })
      }

      return results
    })

    return RichContentMicroResolver.of({
      resolveMany: (ids) =>
        resolveMany(ids).pipe(
          Effect.catch(() =>
            Effect.logWarning('richContent.micro.invalidSnapshot').pipe(Effect.as(new Map())),
          ),
        ),
    })
  }),
)
