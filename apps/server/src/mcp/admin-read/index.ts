import { eq, type SQL, sql } from 'drizzle-orm'
import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { audioTable } from '@/db/audio.schema'
import { Database } from '@/db/layer'
import { postsTable } from '@/db/post.schema'
import { releasesTable } from '@/db/release.schema'
import { showsTable } from '@/db/show.schema'

import { McpAuthorization, McpAuthorizationLive, McpPermission } from '../authorization'
import { EndpointIdentity, McpToolError } from '../contracts'
import { EditorialMcpConfig } from '../editorial'

const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))

const ContentCounts = Schema.Struct({ published: Count, drafts: Count })

export const AdminOverviewResult = Schema.Struct({
  endpoint: EndpointIdentity,
  generatedAt: Schema.String,
  status: Schema.Literal('complete'),
  publishing: Schema.Struct({
    mixes: ContentCounts,
    tracks: ContentCounts,
    miscAudio: ContentCounts,
    shows: ContentCounts,
    posts: ContentCounts,
    micros: ContentCounts,
    releases: ContentCounts,
  }),
})

const unavailable = () =>
  new McpToolError({ code: 'unavailable', message: 'Admin overview unavailable.' })

const makeAdminRead = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  // Same draft/published predicate as the browser overview. Aggregate in storage;
  // never load the dashboard DTO or any content/account/provider rows.
  const counts = (
    category: keyof typeof AdminOverviewResult.Type.publishing,
    table: typeof audioTable | typeof postsTable | typeof showsTable | typeof releasesTable,
    where?: SQL,
  ) =>
    Effect.tryPromise({
      try: () =>
        db
          .select({
            published:
              sql<number>`coalesce(sum(case when ${table.draft} = 0 then 1 else 0 end), 0)`.mapWith(
                Number,
              ),
            drafts:
              sql<number>`coalesce(sum(case when ${table.draft} = 1 then 1 else 0 end), 0)`.mapWith(
                Number,
              ),
          })
          .from(table)
          .where(where),
      catch: unavailable,
    }).pipe(
      Effect.flatMap((rows) => Schema.decodeUnknownEffect(ContentCounts)(rows[0])),
      Effect.tapError(() =>
        Effect.logError('mcp.admin_read.unavailable', {
          operation: 'publishing.count',
          category,
          dependency: 'database',
        }),
      ),
      Effect.mapError(unavailable),
    )

  const getAdminOverview = Effect.fn('AdminReadService.getAdminOverview')(function* () {
    yield* authorization
      .highTrust('admin:read')
      .pipe(
        Effect.mapError((error) => new McpToolError({ code: error.code, message: error.message })),
      )

    const publishing = yield* Effect.all({
      mixes: counts('mixes', audioTable, eq(audioTable.type, 'mix')),
      tracks: counts('tracks', audioTable, eq(audioTable.type, 'track')),
      miscAudio: counts('miscAudio', audioTable, eq(audioTable.type, 'misc')),
      shows: counts('shows', showsTable),
      posts: counts('posts', postsTable, eq(postsTable.type, 'post')),
      micros: counts('micros', postsTable, eq(postsTable.type, 'micro')),
      releases: counts('releases', releasesTable),
    })

    return {
      endpoint,
      generatedAt: DateTime.formatIso(yield* DateTime.now),
      status: 'complete' as const,
      publishing,
    }
  })

  return { getAdminOverview }
})

export class AdminReadService extends Context.Service<
  AdminReadService,
  Effect.Success<typeof makeAdminRead>
>()('gbfm/mcp/AdminReadService') {}

export const AdminReadServiceLayer = Layer.effect(AdminReadService, makeAdminRead).pipe(
  Layer.provide(McpAuthorizationLive),
)

export const AdminReadToolkit = Toolkit.make(
  Tool.make('get_admin_overview', {
    description:
      'Read fixed aggregate publishing counts only. Requires explicit admin:read and current admin eligibility. Empty categories return zero. No personal data, content rows, provider calls or mutations. Any unavailable category fails the whole summary; counts are observed sequentially, not a transactional snapshot.',
    parameters: Tool.EmptyParams,
    success: AdminOverviewResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['admin:read'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

export const AdminReadToolHandlersLayer = AdminReadToolkit.toLayer(
  Effect.map(AdminReadService, (service) => ({ get_admin_overview: service.getAdminOverview })),
)
