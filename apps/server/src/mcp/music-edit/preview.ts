import { eq } from 'drizzle-orm'
import { Context, Effect, Layer, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { Database } from '@/db/layer'
import { ALBUM_TYPES, musicAlbumsTable, musicTracksTable } from '@/db/music-entity.schema'

import { McpAuthorization, McpPermission } from '../authorization'
import { EndpointIdentity, McpToolError } from '../contracts'
import { EditorialMcpConfig } from '../editorial'

const Id = Schema.NonEmptyString.check(Schema.isMaxLength(200))

// This is deliberately not an apply envelope: no request key or revision is issued
// until the shared browser/MCP writer and durable receipt gate are satisfied.
export const PreviewMetadataInput = Schema.Struct({
  change: Schema.Union([
    Schema.Struct({
      operation: Schema.Literal('set_album_type'),
      entityId: Id,
      albumType: Schema.NullOr(Schema.Literals(ALBUM_TYPES)),
    }),
    Schema.Struct({
      operation: Schema.Literal('set_track_album'),
      entityId: Id,
      albumId: Schema.NullOr(Id),
    }),
  ]),
}).annotate({ parseOptions: { onExcessProperty: 'error' } })

export const PreviewMetadataResult = Schema.Struct({
  endpoint: EndpointIdentity,
  status: Schema.Literal('preview_only'),
  operation: Schema.Literals(['set_album_type', 'set_track_album']),
  entityId: Id,
  field: Schema.Literals(['albumType', 'albumId']),
  before: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
  after: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
  changed: Schema.Boolean,
  applyAvailable: Schema.Literal(false),
  limitation: Schema.Literal(
    'Shared atomic revision and durable receipt support is not installed.',
  ),
})

const unavailable = () =>
  new McpToolError({ code: 'unavailable', message: 'Music metadata preview is unavailable.' })

const notFound = () => new McpToolError({ code: 'not_found', message: 'Music entity not found.' })

const makePreview = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const config = yield* EditorialMcpConfig

  return {
    preview: Effect.fn('MusicEdit.preview')(function* (raw: Schema.Json) {
      yield* authorization
        .highTrust('catalogue:write')
        .pipe(
          Effect.mapError(
            (error) => new McpToolError({ code: error.code, message: error.message }),
          ),
        )

      const { change: input } = yield* Schema.decodeUnknownEffect(PreviewMetadataInput)(raw, {
        onExcessProperty: 'error',
      }).pipe(
        Effect.mapError(
          () => new McpToolError({ code: 'invalid_input', message: 'Invalid metadata preview.' }),
        ),
      )

      // One statement observes both the track and referenced album. No provider,
      // mutation service, cache enrichment, receipt or identity writer is invoked.
      const row = yield* Effect.tryPromise({
        try: async () => {
          if (input.operation === 'set_album_type') {
            const [album] = await db
              .select({ before: musicAlbumsTable.albumType })
              .from(musicAlbumsTable)
              .where(eq(musicAlbumsTable.id, input.entityId))
              .limit(1)

            return album && { ...album, referenceExists: true }
          }

          const [track] = await db
            .select({ before: musicTracksTable.albumId, referencedId: musicAlbumsTable.id })
            .from(musicTracksTable)
            .leftJoin(musicAlbumsTable, eq(musicAlbumsTable.id, input.albumId ?? ''))
            .where(eq(musicTracksTable.id, input.entityId))
            .limit(1)

          return (
            track && {
              before: track.before,
              referenceExists: input.albumId === null || track.referencedId !== null,
            }
          )
        },
        catch: unavailable,
      })

      if (!row || !row.referenceExists) return yield* notFound()

      const observed = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ before: PreviewMetadataResult.fields.before }),
      )(row).pipe(Effect.mapError(unavailable))

      const after = input.operation === 'set_album_type' ? input.albumType : input.albumId

      return yield* Schema.decodeUnknownEffect(PreviewMetadataResult)({
        endpoint: {
          environment: config.environment,
          resourceUrl: config.resourceUrl,
          frontendUrl: config.frontendUrl,
        },
        status: 'preview_only',
        operation: input.operation,
        entityId: input.entityId,
        field: input.operation === 'set_album_type' ? 'albumType' : 'albumId',
        before: observed.before,
        after,
        changed: observed.before !== after,
        applyAvailable: false,
        limitation: 'Shared atomic revision and durable receipt support is not installed.',
      }).pipe(Effect.mapError(unavailable))
    }),
  }
})

export class MusicEditPreview extends Context.Service<
  MusicEditPreview,
  Effect.Success<typeof makePreview>
>()('gbfm/mcp/MusicEditPreview') {}

export const MusicEditPreviewLive = Layer.effect(MusicEditPreview, makePreview)

// Export for P1 composition only; this slice does not alter the central registry.
export const MusicEditPreviewToolkit = Toolkit.make(
  Tool.make('preview_metadata_changes', {
    description:
      'Read-only proposed album-type or track-album change. Admin and catalogue:write required. Explicit null clears the field. Returns observed before/after, not a revision, reservation or apply authorization. Other metadata and relationship previews are not yet supported. Apply is unavailable pending shared atomic revisions and durable receipts.',
    parameters: PreviewMetadataInput,
    success: PreviewMetadataResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:write'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

export const MusicEditPreviewHandlers = MusicEditPreviewToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* MusicEditPreview

    return { preview_metadata_changes: service.preview }
  }),
)
