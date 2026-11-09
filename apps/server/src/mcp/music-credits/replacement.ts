import { Effect } from 'effect'

import type {
  musicArtistAliasesTable,
  musicRecordingCreditsTable,
} from '../../db/music-credit.schema'
import {
  checkAliasReplacement,
  checkCreditReplacement,
  musicFactNameKey,
  type SetArtistAliasesInput,
  type SetRecordingCreditsInput,
} from './contract'

/** Supplied once per new operation, after receipt lookup. Never regenerate on replay. */
interface Assertion {
  readonly actorId: string
  readonly now: Date
  readonly newId: () => string
}

/** Materialize exact rows before budget preflight; retain unchanged assertion metadata.
 * Call only after receipt lookup and complete current-state observation.
 */
export const prepareCreditReplacement = Effect.fn('MusicCredits.prepareCreditReplacement')(
  function* (
    input: typeof SetRecordingCreditsInput.Type,
    existing: ReadonlyArray<typeof musicRecordingCreditsTable.$inferSelect>,
    assertion: Assertion,
  ) {
    yield* checkCreditReplacement(input, existing)
    const previous = new Map(existing.map((row) => [row.id, row]))
    let changed = input.credits.length !== existing.length

    const rows = input.credits.map((item, displayOrder) => {
      const old = item.id === undefined ? undefined : previous.get(item.id)

      const same =
        old !== undefined &&
        old.artistId === (item.artistId ?? null) &&
        old.creditedName === item.creditedName &&
        old.role === item.role &&
        old.instrument === (item.instrument ?? null) &&
        old.displayOrder === displayOrder &&
        old.sourceLabel === item.sourceLabel &&
        old.sourceUrl === (item.sourceUrl ?? null) &&
        old.evidenceNote === (item.evidenceNote ?? null)

      if (same) return old
      changed = true
      const creditedNameKey = musicFactNameKey(item.creditedName)

      return {
        id: item.id ?? assertion.newId(),
        trackId: input.target.type === 'track' ? input.target.id : null,
        albumId: input.target.type === 'album' ? input.target.id : null,
        artistId: item.artistId ?? null,
        creditedName: item.creditedName,
        creditedNameKey,
        role: item.role,
        instrument: item.instrument ?? null,
        instrumentKey: item.instrument === undefined ? '' : musicFactNameKey(item.instrument),
        participantKey: item.artistId ? `artist:${item.artistId}` : `name:${creditedNameKey}`,
        displayOrder,
        sourceLabel: item.sourceLabel,
        sourceUrl: item.sourceUrl ?? null,
        evidenceNote: item.evidenceNote ?? null,
        assertedById: assertion.actorId,
        assertedAt: assertion.now,
        createdAt: old?.createdAt ?? assertion.now,
      }
    })

    return { rows, changed }
  },
)

/** Alias input order has no meaning; identity, spelling and evidence do.
 * The read projection orders these rows by SQLite BINARY name key and ID.
 */
export const prepareAliasReplacement = Effect.fn('MusicCredits.prepareAliasReplacement')(function* (
  input: typeof SetArtistAliasesInput.Type,
  primaryName: string,
  existing: ReadonlyArray<typeof musicArtistAliasesTable.$inferSelect>,
  assertion: Assertion,
) {
  yield* checkAliasReplacement(
    input,
    primaryName,
    existing.map((row) => row.id),
  )
  const previous = new Map(existing.map((row) => [row.id, row]))
  let changed = input.aliases.length !== existing.length

  const rows = input.aliases.map((item) => {
    const old = item.id === undefined ? undefined : previous.get(item.id)

    const same =
      old !== undefined &&
      old.name === item.name &&
      old.sourceLabel === item.sourceLabel &&
      old.sourceUrl === (item.sourceUrl ?? null) &&
      old.evidenceNote === (item.evidenceNote ?? null)

    if (same) return old
    changed = true

    return {
      id: item.id ?? assertion.newId(),
      artistId: input.artistId,
      name: item.name,
      nameKey: musicFactNameKey(item.name),
      sourceLabel: item.sourceLabel,
      sourceUrl: item.sourceUrl ?? null,
      evidenceNote: item.evidenceNote ?? null,
      assertedById: assertion.actorId,
      assertedAt: assertion.now,
      createdAt: old?.createdAt ?? assertion.now,
    }
  })

  return { rows, changed }
})
