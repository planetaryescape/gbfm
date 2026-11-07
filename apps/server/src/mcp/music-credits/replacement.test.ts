import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'

import { parseArtistAliases, parseRecordingCredits } from './contract'
import { prepareAliasReplacement, prepareCreditReplacement } from './replacement'

const targetId = '00000000-0000-4000-8000-000000000001'

const rowId = '00000000-0000-4000-8000-000000000002'

const artistId = '00000000-0000-4000-8000-000000000003'

const secondId = '00000000-0000-4000-8000-000000000004'

const common = { requestId: targetId, expectedVersion: `music:sha256:${'a'.repeat(64)}` }

const evidence = { sourceLabel: 'Sleeve', evidenceNote: 'Page 2' }

const assertion = {
  actorId: 'admin-first',
  now: new Date(1_800_000_000_000),
  newId: () => rowId,
}

const later = { ...assertion, actorId: 'admin-second', now: new Date(1_800_000_010_000) }

describe('M2 exact replacement rows', () => {
  test('preserves no-op metadata, materializes explicit unlink and preserves row creation', async () => {
    const initial = await Effect.runPromise(
      parseRecordingCredits({
        ...common,
        target: { type: 'track', id: targetId },
        credits: [
          { artistId, creditedName: 'Écho', role: 'instrument', instrument: ' BASS ', ...evidence },
        ],
      }),
    )

    const created = await Effect.runPromise(prepareCreditReplacement(initial, [], assertion))
    expect(created.changed).toBe(true)
    expect(created.rows).toEqual([
      {
        id: rowId,
        trackId: targetId,
        albumId: null,
        artistId,
        creditedName: 'Écho',
        creditedNameKey: 'écho',
        role: 'instrument',
        instrument: 'BASS',
        instrumentKey: 'bass',
        participantKey: `artist:${artistId}`,
        displayOrder: 0,
        ...evidence,
        sourceUrl: null,
        assertedById: assertion.actorId,
        assertedAt: assertion.now,
        createdAt: assertion.now,
      },
    ])

    const unchanged = {
      ...initial,
      credits: initial.credits.map((item) => ({ ...item, id: rowId })),
    }

    expect(
      await Effect.runPromise(prepareCreditReplacement(unchanged, created.rows, later)),
    ).toEqual({ rows: created.rows, changed: false })

    const unlinked = {
      ...unchanged,
      credits: unchanged.credits.map((item) => ({ ...item, artistId: null })),
    }

    const edited = await Effect.runPromise(prepareCreditReplacement(unlinked, created.rows, later))
    expect(edited.changed).toBe(true)
    expect(edited.rows).toMatchObject([
      {
        id: rowId,
        artistId: null,
        participantKey: 'name:écho',
        creditedName: 'Écho',
        assertedById: later.actorId,
        assertedAt: later.now,
        createdAt: assertion.now,
      },
    ])
    expect(
      await Effect.runPromise(
        prepareCreditReplacement({ ...initial, credits: [] }, edited.rows, later),
      ),
    ).toEqual({ rows: [], changed: true })
    expect(
      await Effect.runPromise(prepareCreditReplacement({ ...initial, credits: [] }, [], later)),
    ).toEqual({ rows: [], changed: false })
  })

  test('credit order is significant; alias order is not, and alias edits retain IDs', async () => {
    const creditInput = await Effect.runPromise(
      parseRecordingCredits({
        ...common,
        target: { type: 'album', id: targetId },
        credits: [
          { creditedName: 'First', role: 'performer', ...evidence },
          { creditedName: 'Second', role: 'producer', ...evidence },
        ],
      }),
    )

    const ids = [rowId, secondId].values()

    const created = await Effect.runPromise(
      prepareCreditReplacement(creditInput, [], {
        ...assertion,
        newId: () => ids.next().value ?? targetId,
      }),
    )

    const reversed = {
      ...creditInput,
      credits: creditInput.credits
        .map((item, i) => ({ ...item, id: i === 0 ? rowId : secondId }))
        .toReversed(),
    }

    const reordered = await Effect.runPromise(
      prepareCreditReplacement(reversed, created.rows, later),
    )

    expect(reordered.changed).toBe(true)
    expect(reordered.rows).toMatchObject([
      { id: secondId, albumId: targetId, trackId: null, displayOrder: 0 },
      { id: rowId, albumId: targetId, trackId: null, displayOrder: 1 },
    ])

    const aliasInput = await Effect.runPromise(
      parseArtistAliases({
        ...common,
        artistId,
        aliases: [
          { name: 'ÉCHO  Other', ...evidence },
          { name: 'Second', ...evidence },
        ],
      }),
    )

    const aliasIds = [rowId, secondId].values()

    const aliases = await Effect.runPromise(
      prepareAliasReplacement(aliasInput, 'Main', [], {
        ...assertion,
        newId: () => aliasIds.next().value ?? targetId,
      }),
    )

    expect(aliases.rows[0]).toMatchObject({ name: 'ÉCHO  Other', nameKey: 'écho other' })

    const same = {
      ...aliasInput,
      aliases: aliasInput.aliases
        .map((item, i) => ({ ...item, id: i === 0 ? rowId : secondId }))
        .toReversed(),
    }

    const noOp = await Effect.runPromise(prepareAliasReplacement(same, 'Main', aliases.rows, later))
    expect(noOp.changed).toBe(false)
    expect(noOp.rows).toEqual(aliases.rows.toReversed())

    const edited = await Effect.runPromise(
      prepareAliasReplacement(
        {
          ...same,
          aliases: same.aliases.map((item) => ({ ...item, evidenceNote: 'Page 3' })),
        },
        'Main',
        aliases.rows,
        later,
      ),
    )

    expect(edited.changed).toBe(true)
    expect(edited.rows).toMatchObject([
      {
        id: secondId,
        createdAt: assertion.now,
        assertedById: later.actorId,
        assertedAt: later.now,
      },
      { id: rowId, createdAt: assertion.now, assertedById: later.actorId, assertedAt: later.now },
    ])
  })
})
