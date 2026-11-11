import { Effect, Layer, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpAuthorizationLive, McpPermission } from '@/mcp/authorization'
import { EditorialToolError, EndpointIdentity, McpToolError } from '@/mcp/contracts'
import { EditorialMcpConfig } from '@/mcp/editorial'

import { MusicImportArtworkLayer } from './artwork'
import { ImportMusicUrlInput, MusicImportCommandsLayer } from './commands'
import { MusicImportExecutionAuthorityLayer } from './execution-authority'
import {
  musicImportScopes,
  MusicImportResult,
  MusicUrlImport,
  MusicUrlImportLayer,
} from './service'

const output = Schema.Struct({ endpoint: EndpointIdentity, import: MusicImportResult })

const failure = Schema.Union([EditorialToolError, McpToolError])

const parameters = Schema.Struct({
  ...ImportMusicUrlInput.fields,
  expectedType: Schema.optionalKey(Schema.Literals(['artist', 'album', 'track'])),
})

export const MusicImportToolkit = Toolkit.make(
  Tool.make('import_music_url', {
    description:
      'Import one exact artist, album or track URL into the GBFM catalogue. Admin plus catalogue:write catalogue:import providers:read required. Playlist imports are not enabled. Supply one UUIDv4 requestId and explicit artworkDelivery. Retrying identical input and requestId preserves original created/reused catalogue evidence and resumes recoverable artwork. Never substitute a similarly named release. Catalogue receipt is distinct from latest artwork phase; pending/uploading/association_pending is not delivery. No automatic background completion is promised. After timeout use the same input, never a fresh requestId. Expired keys never import again. No provider-account writes.',
    parameters,
    success: output,
    failure,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: musicImportScopes })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, true)
    .annotate(Tool.Strict, true),
  Tool.make('get_music_import_status', {
    description:
      'Inspect the original scoped music-import receipt and current artwork phase using exactly the original requestId and import input. Same admin/scopes as import. Does not fetch providers, upload artwork or create catalogue records. A missing receipt is not proof an interrupted preparation failed. Resume incomplete artwork with import_music_url and identical input. Expired keys never import again.',
    parameters,
    success: output,
    failure,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: musicImportScopes })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

export const MusicImportHandlersLayer = MusicImportToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* MusicUrlImport
    const endpoint = yield* EditorialMcpConfig

    const apply = (input: typeof ImportMusicUrlInput.Type, mode: 'import' | 'status') =>
      Effect.gen(function* () {
        return { endpoint, import: yield* service.execute(input, mode) }
      })

    return {
      import_music_url: (input) => apply(input, 'import'),
      get_music_import_status: (input) => apply(input, 'status'),
    }
  }),
)

export const MusicImportHandlersLive = MusicImportHandlersLayer.pipe(
  Layer.provide(
    MusicUrlImportLayer.pipe(
      Layer.provide(
        MusicImportExecutionAuthorityLayer.pipe(
          Layer.provide(MusicImportCommandsLayer.pipe(Layer.provide(McpAuthorizationLive))),
          Layer.provide(McpAuthorizationLive),
        ),
      ),
      Layer.provide(MusicImportArtworkLayer),
    ),
  ),
)
