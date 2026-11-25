import { Clock, Effect, Option, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import type { Database } from '@/db/layer'

import { McpPermission } from '../authorization'
import { CommandAuthority } from '../command-authority'
import { McpToolError } from '../contracts'
import type { McpOperationStore } from '../operations/store'
import { AttachLinkInput, LinkEditResult, ReleaseLinkInput } from './contracts'
import { applyMusicLink } from './executor'

/** Registration stays with P1. These tools never call legacy raw canonical writers. */
export const LinkEditToolkit = Toolkit.make(
  Tool.make('attach_music_link', {
    description:
      'Attach one exact, admin-attested verified streaming/source URL to an existing native artist, album or track. Requires admin and catalogue:write, observed expectedRevision and UUIDv4 requestId. Supports Tidal, Apple Music and Bandcamp through the canonical URL parser. No remote fetch or independent verification: supply an already checked exact link, never a guessed release match. Does not overwrite different URLs or resurrect rejected links. No imports or metadata/artwork changes. Identical retries replay the original committed revision for 24 hours; changed input conflicts and expired keys never write again.',
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

export const MusicLinkAttachmentToolkit = Toolkit.make(LinkEditToolkit.tools.attach_music_link)

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
    const context = yield* Effect.context<Database | McpOperationStore>()

    const execute = Effect.fn('LinkEdit.execute')(function* (...args: Parameters<typeof apply>) {
      const authority = yield* Effect.serviceOption(CommandAuthority)

      if (Option.isNone(authority))
        return yield* new McpToolError({
          code: 'access_denied',
          message: 'Command authority required.',
        })

      return yield* apply(...args).pipe(
        Effect.provideService(CommandAuthority, authority.value),
        Effect.provideContext(context),
      )
    })

    return {
      attach_music_link: (input) =>
        execute(input, {
          operation: 'attach_music_link',
          platform: input.platform,
          url: input.url,
        }),
      reject_music_link: (input) =>
        execute(input, { operation: 'reject_music_link', linkId: input.linkId }),
      remove_music_link: (input) =>
        execute(input, { operation: 'remove_music_link', linkId: input.linkId }),
    }
  }),
)
