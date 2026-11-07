import { Effect, type Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'

import { McpPermission } from '../authorization'
import { EditorialToolError } from '../contracts'
import {
  CompareEntriesInput,
  CompareEntriesResult,
  ConflictInput,
  ConflictResult,
  DuplicateInput,
  DuplicateResult,
  IncompleteResult,
  QualitySummaryInput,
  QualitySummaryResult,
  QualityWindowInput,
} from './contracts'
import { CatalogueQualityService } from './service'

const inspection = <Name extends string, P extends Schema.Constraint, S extends Schema.Constraint>(
  name: Name,
  description: string,
  parameters: P,
  success: S,
) =>
  Tool.make(name, {
    description,
    parameters,
    success,
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:inspect'] })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.Strict, true)

export const CatalogueQualityToolkit = Toolkit.make(
  inspection(
    'find_duplicate_candidates',
    'Admin-only same-kind exact SQLite casefolded name candidates. Hypotheses, never equality or merge decisions; bounded ID seek default20/max50.',
    DuplicateInput,
    DuplicateResult,
  ),
  inspection(
    'compare_music_entries',
    'Admin-only safe metadata comparison for two explicit references; full stored names compared with SQLite casefolding, displayed names truncated. No musical equivalence/merge verdict.',
    CompareEntriesInput,
    CompareEntriesResult,
  ),
  inspection(
    'find_incomplete_entries',
    'Admin-only diagnostics in one bounded examined ID window. Returns missing-field reasons and scanned cursor, not all incomplete entries or repair.',
    QualityWindowInput,
    IncompleteResult,
  ),
  inspection(
    'list_music_identity_conflicts',
    'Admin-only bounded open conflict window ordered detectedAt/ID. Safe targets and conflict IDs only, no source payload/lease owner/reason dumps; unsupported kinds are skipped with cursor advancement.',
    ConflictInput,
    ConflictResult,
  ),
  inspection(
    'get_catalogue_quality_summary',
    'Admin-only counts in one catalogue ID window and one existing resolving-identity audit window. Not catalogue totals; separate cursors, no repair or maintenance job.',
    QualitySummaryInput,
    QualitySummaryResult,
  ),
)

export const CatalogueQualityHandlersLayer = CatalogueQualityToolkit.toLayer(
  Effect.gen(function* () {
    const s = yield* CatalogueQualityService

    return {
      find_duplicate_candidates: s.findDuplicateCandidates,
      compare_music_entries: s.compareMusicEntries,
      find_incomplete_entries: s.findIncompleteEntries,
      list_music_identity_conflicts: s.listMusicIdentityConflicts,
      get_catalogue_quality_summary: s.getCatalogueQualitySummary,
    }
  }),
)
