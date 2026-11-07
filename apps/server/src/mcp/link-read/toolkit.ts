import { Effect, type Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError } from '../contracts'
import {
  CompareSourcesInput,
  CompareSourcesResult,
  EquivalentInput,
  EquivalentResult,
  HealthInput,
  HealthResult,
  LinkPageInput,
  LinksResult,
  MissingLinksInput,
  MissingLinksResult,
} from './contracts'
import { LinkReadService } from './service'

const read = <
  Name extends string,
  Config extends {
    readonly parameters: Schema.Constraint
    readonly success: Schema.Constraint
    readonly failure: Schema.Constraint
    readonly failureMode: Tool.FailureMode
  },
  R,
>(
  tool: Tool.Tool<Name, Config, R>,
  providers = false,
) =>
  tool
    .annotate(McpPermission, {
      scopes: providers ? ['catalogue:read', 'providers:read'] : ['catalogue:read'],
    })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.OpenWorld, providers)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.Strict, true)

export const LinkReadToolkit = Toolkit.make(
  read(
    Tool.make('get_music_links', {
      description:
        'Page safe verified stored links of an existing public catalogue entry. Stable link IDs and observations; platform seek cursor, default20/max50 scanned rows. No provider fetch or writes.',
      parameters: LinkPageInput,
      success: LinksResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('find_platform_equivalent', {
      description:
        'Find a verified stored platform link of the SAME catalogue entry. Insufficient evidence when absent/unsafe; no guessed musical equivalence, fetch or writes.',
      parameters: EquivalentInput,
      success: EquivalentResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('check_music_link_health', {
      description:
        'Availability-only HEAD observation of a safe verified stored provider link. Requires providers:read. Exact provider allowlist, at most3 HEADs/2 redirects/4 seconds/zero body bytes. Fails closed without trusted private-network-blocked egress. HTTP success is NOT musical equivalence; never writes verification state.',
      parameters: HealthInput,
      success: HealthResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
    true,
  ),
  read(
    Tool.make('find_missing_platform_links', {
      description:
        'Inspect one bounded ID-ordered catalogue window (default20/max50). Return entries without a safe verified stored platform link and next scanned-ID cursor; not a complete catalogue missing count.',
      parameters: MissingLinksInput,
      success: MissingLinksResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
  read(
    Tool.make('compare_music_sources', {
      description:
        'Compare two normalized URLs through stored identity lookup only. Same/different catalogue targets are evidence, never a verdict of musical equivalence or mismatch; unresolved returns insufficient_evidence. No fetch or mutation.',
      parameters: CompareSourcesInput,
      success: CompareSourcesResult,
      failure: EditorialToolError,
      failureMode: 'return',
    }),
  ),
)

export const LinkReadHandlersLayer = LinkReadToolkit.toLayer(
  Effect.gen(function* () {
    const service = yield* LinkReadService

    return {
      get_music_links: service.getMusicLinks,
      find_platform_equivalent: service.findPlatformEquivalent,
      check_music_link_health: service.checkMusicLinkHealth,
      find_missing_platform_links: service.findMissingPlatformLinks,
      compare_music_sources: service.compareMusicSources,
    }
  }),
)
