import { Clock, Effect, Option, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { CommandAuthority } from '../command-authority'
import { McpToolError } from '../contracts'
import { McpWireResponse } from '../wire-response'
import { SetArtistAliasesInput, SetRecordingCreditsInput } from './contract'
import { MusicFactsWriteResult } from './projection'
import { MusicFactsService } from './service'

// Preserve untrimmed/raw strings for the service's 128 KiB admission check. A missing
// version reaches its typed precondition_required boundary rather than a protocol error.
const creditsParameters = Schema.toEncoded(
  Schema.Struct({
    ...SetRecordingCreditsInput.fields,
    expectedVersion: Schema.optionalKey(SetRecordingCreditsInput.fields.expectedVersion),
  }),
)

const aliasesParameters = Schema.toEncoded(
  Schema.Struct({
    ...SetArtistAliasesInput.fields,
    expectedVersion: Schema.optionalKey(SetArtistAliasesInput.fields.expectedVersion),
  }),
)

/** P1 composition export only. This module does not activate either command. */
export const MusicFactsToolkit = Toolkit.make(
  Tool.make('set_recording_credits', {
    description:
      'Replace all recording credits on one track or explicitly album-wide; never propagates, edits billing or publishes. Admin and catalogue:write required. Supply the fresh complete editable collection expectedVersion and a new UUIDv4 requestId; retry only the identical payload/requestId for 24 hours. Omitted rows are removed; [] clears. Keep existing row IDs, explicitly keep/change artistId or send null to unlink a linked row. Name-only credits are allowed; no name/alias identity inference. Roles performer/instrument/producer/engineer; instrument only for instrument role. Each item requires public sourceLabel and sourceUrl or evidenceNote. Sources are not fetched/verified. Max50 items,128KiB input; outcome64KiB and full editable/read/wire response256KiB. No-op retains revision. Oversized, stale or invalid collections never partially apply.',
    parameters: creditsParameters,
    success: MusicFactsWriteResult,
    failure: McpToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:write'] })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Strict, true),
  Tool.make('set_artist_aliases', {
    description:
      'Replace all alternate names for one artist; no identity merges, provider bindings, artist rename or credit/billing changes. Admin and catalogue:write required. Supply the parent artist fresh complete editable expectedVersion and a new UUIDv4 requestId; retry only the identical payload/requestId for 24 hours. Omitted rows are removed; [] clears; keep existing row IDs. Alias order is immaterial; names must be unique after NFC/trim/collapse/lower/NFC and differ from the primary name. Each item requires public sourceLabel and sourceUrl or evidenceNote; sources are not fetched/verified. Max50 items,128KiB input; outcome64KiB and full editable/read/wire response256KiB. No-op retains revision; stale/invalid/oversized edits never partially apply.',
    parameters: aliasesParameters,
    success: MusicFactsWriteResult,
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

export const MusicFactsHandlersLayer = MusicFactsToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* MusicFactsService

    const write = Effect.fn('MusicFacts.writeIntent')(function* (
      kind: 'credits' | 'aliases',
      input: Schema.Json,
    ) {
      // The HTTP route injects both services per admitted request. Missing context
      // is a typed denial/unavailability, never a captured principal or fallback budget.
      const authority = yield* Effect.serviceOption(CommandAuthority)

      if (Option.isNone(authority))
        return yield* new McpToolError({
          code: 'access_denied',
          message: 'Music command authority required.',
        })
      const wire = yield* Effect.serviceOption(McpWireResponse)

      if (Option.isNone(wire))
        return yield* new McpToolError({
          code: 'unavailable',
          message: 'Music command wire context required.',
        })
      const now = yield* Clock.currentTimeMillis

      const result =
        kind === 'credits'
          ? service.setRecordingCredits(input, now, wire.value)
          : service.setArtistAliases(input, now, wire.value)

      return yield* result.pipe(Effect.provideService(CommandAuthority, authority.value))
    })

    return {
      set_recording_credits: (input) => write('credits', input),
      set_artist_aliases: (input) => write('aliases', input),
    }
  }),
)
