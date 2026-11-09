import { Context, Effect, Layer, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { Database } from '@/db/layer'

import { McpAuthorization, McpPermission } from '../authorization'
import { EndpointIdentity, McpToolError } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { MusicEditCommand, MusicEditId, MusicEditPreviewInput, MusicRevision } from './commands'
import { planMusicEdit } from './planner'

export const PreviewMetadataInput = MusicEditPreviewInput

export const PreviewMetadataResult = Schema.Struct({
  endpoint: EndpointIdentity,
  status: Schema.Literal('preview_only'),
  operation: Schema.Literals([
    'update_music_metadata',
    'set_music_genres',
    'set_album_type',
    'set_track_album',
    'set_artist_credit',
    'remove_artist_credit',
    'set_label_affiliation',
    'remove_label_affiliation',
  ]),
  entityId: MusicEditId,
  field: Schema.Literals(['metadata', 'genres', 'albumType', 'albumId', 'credits', 'labelIds']),
  before: Schema.Json,
  after: Schema.Json,
  changed: Schema.Boolean,
  expectedRevision: MusicRevision,
  references: MusicEditCommand.fields.references,
  applyAvailable: Schema.Literal(false),
  limitation: Schema.Literal(
    'Mutation activation awaits live command authority and all-client guarded writers.',
  ),
})

const unavailable = () =>
  new McpToolError({ code: 'unavailable', message: 'Music metadata preview is unavailable.' })

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

      const plan = yield* planMusicEdit(input).pipe(Effect.provideService(Database, db))

      return yield* Schema.decodeUnknownEffect(PreviewMetadataResult)({
        endpoint: {
          environment: config.environment,
          resourceUrl: config.resourceUrl,
          frontendUrl: config.frontendUrl,
        },
        status: 'preview_only',
        operation: input.operation,
        entityId: input.entityId,
        field: plan.field,
        before: plan.before,
        after: plan.after,
        changed: plan.changed,
        expectedRevision: plan.revision,
        references: plan.references,
        applyAvailable: false,
        limitation:
          'Mutation activation awaits live command authority and all-client guarded writers.',
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
      'Read-only preview of supported music metadata, genre, album-type, track-album, artist-credit and label-affiliation changes. Admin and catalogue:write required. Explicit null clears nullable fields. Returns bounded before/after and observed target/reference revisions, not a reservation or apply authorization. Mutation activation awaits live command authority and all-client guarded writers.',
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
