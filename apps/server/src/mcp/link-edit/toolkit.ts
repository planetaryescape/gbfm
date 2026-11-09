import { Clock, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { McpToolError } from '../contracts'
import { AttachLinkInput, LinkEditResult, ReleaseLinkInput } from './contracts'
import { applyMusicLink } from './executor'

/** Registration stays with P1. These tools never call legacy raw canonical writers. */
export const LinkEditToolkit = Toolkit.make(
  Tool.make('attach_music_link', {
    description:
      'Attach one safe source to an existing artist, album or track using an observed parent revision and UUIDv4 retry key. Does not overwrite different URLs or resurrect rejected links; explicitly remove then attach. No imports, providers, playlists, labels, metadata or artwork changes.',
    parameters: AttachLinkInput,
    success: LinkEditResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('reject_music_link', {
    description:
      'Reject an existing link without deleting its evidence row. Releases source ownership only when no other verified display link needs it. Expected parent revision and UUIDv4 retry key required; later discovery must not silently restore rejection.',
    parameters: ReleaseLinkInput,
    success: LinkEditResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('remove_music_link', {
    description:
      'Explicitly delete one stored link. Releases source ownership only when no other verified display link needs it. Expected parent revision and UUIDv4 retry key required. Does not delete the catalogue entity.',
    parameters: ReleaseLinkInput,
    success: LinkEditResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
)

const apply = Effect.fn('LinkEdit.tool')(function* (
  input: typeof ReleaseLinkInput.Type | typeof AttachLinkInput.Type,
  change:
    | {
        readonly operation: 'attach_music_link'
        readonly platform: typeof AttachLinkInput.Type.platform
        readonly url: string
      }
    | { readonly operation: 'reject_music_link' | 'remove_music_link'; readonly linkId: string },
) {
  const result = yield* applyMusicLink(
    {
      entityType: input.entityType,
      entityId: input.entityId,
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      change,
    },
    yield* Clock.currentTimeMillis,
  )

  return yield* Schema.decodeUnknownEffect(LinkEditResult)({ result }).pipe(
    Effect.mapError(
      () =>
        new McpToolError({
          code: 'unavailable',
          message: 'Link receipt unavailable; retry identically.',
        }),
    ),
  )
})

export const LinkEditHandlersLayer = LinkEditToolkit.toLayer(
  Effect.gen(function* () {
    const context = yield* Effect.context<Effect.Services<ReturnType<typeof apply>>>()

    return {
      attach_music_link: (input) =>
        apply(input, {
          operation: 'attach_music_link',
          platform: input.platform,
          url: input.url,
        }).pipe(Effect.provideContext(context)),
      reject_music_link: (input) =>
        apply(input, { operation: 'reject_music_link', linkId: input.linkId }).pipe(
          Effect.provideContext(context),
        ),
      remove_music_link: (input) =>
        apply(input, { operation: 'remove_music_link', linkId: input.linkId }).pipe(
          Effect.provideContext(context),
        ),
    }
  }),
)
