import { PostId, type PostVersion } from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { Effect, Schema } from 'effect'

import { Database } from '@/db/layer'
import { validateCanonicalContent } from '@/lib/mdx'
import { McpToolError, PostSlug } from '@/mcp/contracts'
import { CreateMicroPostInput, ReplyToMicroPostInput } from '@/mcp/creator/contracts'
import { EditorialMcpConfig } from '@/mcp/editorial'
import { loadEditorialSnapshot } from '@/mcp/editorial-music/snapshot'
import { projectPost } from '@/mcp/model'
import { attachedMediaUrls } from '@/services/media-publication'
import {
  deriveReplyThreadFields,
  normalizePostData,
  validatePostData,
} from '@/services/post.service'
import { publicMicroAncestorQuery } from '@/services/public-micro-ancestry'

const invalid = () =>
  new McpToolError({ code: 'invalid_input', message: 'Invalid canonical post content.' })

/** No writes, provider calls, rendering, notifications or media publication during preparation. */
export const prepareCreatorMicro = Effect.fn('CreatorCommand.prepareMicro')(function* (options: {
  readonly input: typeof CreateMicroPostInput.Type | typeof ReplyToMicroPostInput.Type
  readonly actorId: string
  readonly now: Date
}) {
  const config = yield* EditorialMcpConfig

  const input = yield* Schema.decodeUnknownEffect(
    Schema.Union([ReplyToMicroPostInput, CreateMicroPostInput]),
    {
      onExcessProperty: 'error',
    },
  )(options.input).pipe(Effect.mapError(invalid))

  const thread = yield* Effect.gen(function* () {
    if (!('parentPostId' in input)) return { parentPostId: null, rootPostId: null, depth: 0 }

    const db = yield* Database

    const parents = yield* Effect.tryPromise({
      try: () => db.all(publicMicroAncestorQuery(input.parentPostId)),
      catch: () => new McpToolError({ code: 'unavailable', message: 'Reply unavailable.' }),
    }).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              id: PostId,
              parentPostId: Schema.NullOr(PostId),
              rootPostId: Schema.NullOr(PostId),
              depth: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8 })),
            }),
          ),
        ),
      ),
      Effect.mapError(
        () => new McpToolError({ code: 'unavailable', message: 'Reply unavailable.' }),
      ),
    )

    const parent = parents[0]

    if (!parent || parent.depth >= 8)
      return yield* new McpToolError({ code: 'not_found', message: 'Reply parent unavailable.' })

    return yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        parentPostId: PostId,
        rootPostId: PostId,
        depth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
      }),
    )(deriveReplyThreadFields(parent)).pipe(Effect.mapError(invalid))
  })

  const id = yield* Schema.decodeUnknownEffect(PostId)(crypto.randomUUID()).pipe(
    Effect.mapError(invalid),
  )

  const slug = yield* Schema.decodeUnknownEffect(PostSlug)(`micro-${id}`).pipe(
    Effect.mapError(invalid),
  )

  const actorId = yield* Schema.decodeUnknownEffect(UserId)(options.actorId).pipe(
    Effect.mapError(invalid),
  )

  const data = normalizePostData(
    {
      id,
      slug: `micro-${id}`,
      title: input.title ?? null,
      content: input.content,
      type: 'micro',
      draft: false,
      description: null,
      thumbnailUrl: null,
      bannerImageUrl: null,
      createdAt: options.now,
      updatedAt: options.now,
      ...thread,
      quotedPostId: null,
      musicEntityType: null,
      musicEntityId: null,
      musicReferencesManaged: false,
    },
    'micro',
  )

  yield* validatePostData(data).pipe(Effect.mapError(invalid))
  yield* validateCanonicalContent(data.content).pipe(Effect.mapError(invalid))

  // A durable provider-copy phase is not available in this atomic post contract yet.
  if (attachedMediaUrls(data).some((url) => url.includes('/user-content/private/')))
    return yield* invalid()

  const projected = yield* projectPost(
    {
      ...data,
      id,
      slug,
      type: 'micro',
      title: data.title ?? null,
      content: data.content ?? null,
      description: null,
      thumbnailUrl: null,
      bannerImageUrl: null,
      draft: false,
      createdAt: options.now,
      updatedAt: options.now,
      tags: [],
      creators: [{ id: actorId }],
      musicEntityType: null,
      musicEntityId: null,
      musicReferencesManaged: false,
      musicReferences: { references: [], primary: null },
      ...thread,
      quotedPostId: null,
    },
    config,
  ).pipe(Effect.mapError(invalid))

  return { data, id, version: projected.version }
})

/** Read-only transition preparation; caller must apply snapshot CAS and live authority in one batch. */
export const prepareCreatorPostTransition = Effect.fn('CreatorCommand.preparePostTransition')(
  function* (options: {
    readonly postId: PostId
    readonly actorId: string
    readonly expectedVersion: PostVersion
    readonly transition: 'publish' | 'unpublish' | 'delete'
    readonly now: Date
  }) {
    const db = yield* Database
    const config = yield* EditorialMcpConfig

    const snapshot = yield* loadEditorialSnapshot(db, options.postId).pipe(
      Effect.mapError(
        (error) =>
          new McpToolError({
            code: error.code,
            message: error.code === 'not_found' ? 'Content not found.' : 'Content unavailable.',
          }),
      ),
    )

    if (
      !snapshot.creators?.some((c) => c.id === options.actorId) ||
      (options.transition === 'publish' && snapshot.type === 'micro')
    )
      return yield* new McpToolError({ code: 'not_found', message: 'Content not found.' })

    const before = yield* projectPost(snapshot, config).pipe(
      Effect.mapError(
        () => new McpToolError({ code: 'unavailable', message: 'Content unavailable.' }),
      ),
    )

    if (
      before.version !== options.expectedVersion ||
      (options.transition !== 'delete' && snapshot.draft !== (options.transition === 'publish'))
    )
      return yield* new McpToolError({
        code: 'conflict',
        message: 'Content changed; read it before another command.',
      })

    if (options.transition === 'publish') {
      yield* validatePostData({
        type: snapshot.type,
        title: snapshot.title,
        content: snapshot.content,
      }).pipe(Effect.mapError(invalid))
      yield* validateCanonicalContent(snapshot.content).pipe(Effect.mapError(invalid))

      if (attachedMediaUrls(snapshot).some((url) => url.includes('/user-content/private/')))
        return yield* invalid()
    }

    const updatedAt = new Date(Math.max(options.now.getTime(), snapshot.updatedAt.getTime() + 1))

    const draft =
      options.transition === 'delete' ? snapshot.draft : options.transition === 'unpublish'

    const after = yield* projectPost({ ...snapshot, updatedAt, draft }, config).pipe(
      Effect.mapError(
        () => new McpToolError({ code: 'unavailable', message: 'Content unavailable.' }),
      ),
    )

    return { snapshot, patch: { draft, updatedAt }, version: after.version }
  },
)
