import type { McpPrincipal, McpResourceUrl } from '@gbfm/core/editorial-mcp'
import { Context, Effect, Layer, Option, type Schema } from 'effect'

import { McpActor, McpAuthorization } from '@/mcp/authorization'
import { McpToolError } from '@/mcp/contracts'
import type { CanonicalMusicEntityType } from '@/services/canonical-music-identity'
import type { MusicIdentityAuthorization } from '@/services/canonical-music-identity/contract'
import { MusicIdentityAuthorizationFailed } from '@/services/canonical-music-identity/errors'

import { MusicImportCommands } from './commands'

// P1 must provide persisted token/grant/client/resource verification, not a
// cached principal. There is deliberately no live default or token storage here.
export class MusicImportLiveGrant extends Context.Service<
  MusicImportLiveGrant,
  {
    readonly reverify: (resource: McpResourceUrl) => Effect.Effect<McpPrincipal, McpToolError>
  }
>()('gbfm/mcp/MusicImportLiveGrant') {}

const makeAuthority = Effect.gen(function* () {
  const configuredActor = yield* Effect.serviceOption(McpActor)
  const configuredGrant = yield* Effect.serviceOption(MusicImportLiveGrant)
  const commands = yield* MusicImportCommands
  const authorization = yield* McpAuthorization

  // Use at admission, before provider work, before each guarded write and before
  // replay. Resolved/reused type comes from the canonical owner, never the hint.
  const check = Effect.fn('MusicImportExecutionAuthority.check')(
    function* (
      raw: Schema.Json,
      resource: McpResourceUrl,
      resolvedType?: CanonicalMusicEntityType,
    ) {
      const originalActor = Option.orElse(
        yield* Effect.serviceOption(McpActor),
        () => configuredActor,
      )

      const liveGrant = Option.orElse(
        yield* Effect.serviceOption(MusicImportLiveGrant),
        () => configuredGrant,
      )

      if (Option.isNone(originalActor) || Option.isNone(liveGrant))
        return yield* new McpToolError({
          code: 'access_denied',
          message: 'Live import authority is required.',
        })
      const original = originalActor.value
      const current = yield* liveGrant.value.reverify(resource)

      if (original.userId !== current.userId || original.clientId !== current.clientId) {
        return yield* new McpToolError({ code: 'access_denied', message: 'MCP access denied.' })
      }

      const prepared = yield* commands
        .prepare(raw, resource)
        .pipe(Effect.provideService(McpActor, current))

      if (resolvedType === 'playlist') {
        yield* authorization
          .highTrust('playlists:write')
          .pipe(Effect.provideService(McpActor, current))
      }

      return prepared
    },
    Effect.catchTag('EditorialToolError', ({ code, message }) =>
      Effect.fail(new McpToolError({ code, message })),
    ),
  )

  const forSource =
    (raw: Schema.Json, resource: McpResourceUrl): MusicIdentityAuthorization =>
    (resolvedType) =>
      check(raw, resource, resolvedType).pipe(
        Effect.asVoid,
        Effect.mapError(
          (error) =>
            new MusicIdentityAuthorizationFailed({
              reason: error.code === 'unavailable' ? 'unavailable' : 'denied',
            }),
        ),
      )

  return { check, forSource }
})

export class MusicImportExecutionAuthority extends Context.Service<
  MusicImportExecutionAuthority,
  Effect.Success<typeof makeAuthority>
>()('gbfm/mcp/MusicImportExecutionAuthority') {}

export const MusicImportExecutionAuthorityLayer = Layer.effect(
  MusicImportExecutionAuthority,
  makeAuthority,
)
