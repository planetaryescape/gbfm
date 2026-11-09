import { RichContentDocument } from '@gbfm/rich-content/schema'
import { Context, Effect, Layer, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { PostService } from '@/services/post.service'

import { McpAuthorization, McpAuthorizationLive, McpPermission } from '../authorization'
import { EditorialToolError, EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { ContentPageInput, ContentPagination, PublicShowInput } from './contracts'

/** Public focus slug plus bounded descendant-page window; no actor/draft override. */
export const PublicMicroThreadInput = Schema.Struct({
  ...PublicShowInput.fields,
  ...ContentPageInput.fields,
})

/** Public source-prose node; no raw source, primary music pair, creator IDs or compiled HTML. */
export const PublicThreadPost = Schema.Struct({
  postId: Schema.String,
  slug: Schema.String,
  title: Schema.NullOr(Schema.String),
  parentPostId: Schema.NullOr(Schema.String),
  rootPostId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  body: RichContentDocument,
})

/** Bounded thread topology/prose, explicitly without hydrated embeds, tables or unsupported source. */
export const PublicMicroThreadResult = Schema.Struct({
  endpoint: EndpointIdentity,
  bodyMode: Schema.Literal('unhydrated'),
  root: PublicThreadPost,
  focus: PublicThreadPost,
  posts: Schema.Array(PublicThreadPost),
  pagination: ContentPagination,
})

const unavailable = () =>
  new EditorialToolError({
    code: 'unavailable',
    message: 'Public thread is unavailable within safe read limits.',
  })

const makeThreadReads = Effect.gen(function* () {
  const authorization = yield* McpAuthorization
  const posts = yield* PostService
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  const readMicroThread = Effect.fn('PublicThread.read')(function* (
    input: typeof PublicMicroThreadInput.Type,
  ) {
    yield* authorization.requireScopes(['content:read'])

    const thread = yield* posts
      .getPublicMicroThread(input.slug, { limit: input.limit ?? 20, offset: input.offset ?? 0 })
      .pipe(
        Effect.catchTags({
          DatabaseError: () => Effect.fail(unavailable()),
          NotFoundError: () =>
            Effect.fail(
              new EditorialToolError({ code: 'not_found', message: 'Thread not found.' }),
            ),
        }),
      )

    const project = (post: typeof thread.root) => ({
      postId: post.id,
      slug: post.slug,
      title: post.title,
      parentPostId: post.parentPostId,
      rootPostId: post.rootPostId,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      body: post.body,
    })

    const output = yield* Schema.decodeUnknownEffect(PublicMicroThreadResult)({
      endpoint,
      bodyMode: thread.bodyMode,
      root: project(thread.root),
      focus: project(thread.focus),
      posts: thread.posts.map(project),
      pagination: thread.pagination,
    }).pipe(Effect.mapError(unavailable))

    if (new TextEncoder().encode(JSON.stringify(output)).byteLength > 256 * 1024)
      return yield* unavailable()

    return output
  })

  return { readMicroThread }
})

/** Public thread handler with live content:read/account authorization. */
export class PublicThreadService extends Context.Service<
  PublicThreadService,
  Effect.Success<typeof makeThreadReads>
>()('gbfm/mcp/PublicThreadService') {}

/** Requires the real PostService, Database (authorization) and EditorialMcpConfig. */
export const PublicThreadServiceLayer = Layer.effect(PublicThreadService, makeThreadReads).pipe(
  Layer.provide(McpAuthorizationLive),
)

/** Independently registered by P1; never automatically broadens production scopes. */
export const PublicThreadToolkit = Toolkit.make(
  Tool.make('read_micro_thread', {
    description:
      'Read public micro-thread root, focus and a bounded descendant page. Structured source prose, bodyMode=unhydrated: ALL embeds become no-link placeholders; tables and unsupported markup are explicitly omitted, never echoed. This is not hydrated rich-embed content. Private/banned focus/root/ancestor gives not_found; hidden descendant subtrees do not enter counts/pages. Oldest-first with ID tie-break. Default 20/max 50, offset <=10000; max depth 8/500 visible nodes, 100KiB/source, 256KiB/result; over-budget fails unavailable, never partial topology. No source IDs, compiled HTML, media resolution, providers, playback or seen writes. Read-only, safe to retry; content:read required.',
    parameters: PublicMicroThreadInput,
    success: PublicMicroThreadResult,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['content:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

/** Typed handler Layer for central authenticated transport composition. */
export const PublicThreadHandlersLayer = PublicThreadToolkit.toLayer(
  Effect.gen(function* () {
    const reads = yield* PublicThreadService

    return { read_micro_thread: reads.readMicroThread }
  }),
)
