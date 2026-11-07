import { Effect, Result, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  DraftMusicReferenceChange,
  DraftMusicReferenceState,
  parseDraftMusicReferences,
  transitionDraftMusicReferences,
} from './post-music-references'

const album = { entityType: 'album', entityId: '00000000-0000-0000-0000-00000000000a' } as const

const track = { entityType: 'track', entityId: '00000000-0000-0000-0000-00000000000b' } as const

const playlist = {
  entityType: 'playlist',
  entityId: '00000000-0000-0000-0000-00000000000c',
} as const

const initial = Schema.decodeUnknownSync(DraftMusicReferenceState)({
  musicReferences: { references: [track, album], primary: album },
  managed: false,
})

describe('draft music references', () => {
  test('keeps order and independent primary; rejects invalid replacements strictly', async () => {
    expect(await Effect.runPromise(parseDraftMusicReferences(initial.musicReferences))).toEqual(
      initial.musicReferences,
    )

    for (const input of [
      { references: [album] },
      { references: [], primary: album },
      { references: [album], primary: playlist },
      { references: [album, { ...album, entityId: album.entityId.toUpperCase() }], primary: null },
      { references: [album], primary: null, ignored: true },
      { references: [{ ...album, url: 'https://example.test' }], primary: null },
    ]) {
      const result = await Effect.runPromise(Effect.result(parseDraftMusicReferences(input)))
      expect(Result.isFailure(result)).toBe(true)
    }
  })

  test('bounds complete distinct targets at 50, without conflating different entity types', async () => {
    const references = Array.from({ length: 50 }, (_, index) => ({
      entityType: 'track',
      entityId: `00000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}`,
    }))

    expect(
      (await Effect.runPromise(parseDraftMusicReferences({ references, primary: null })))
        .references,
    ).toHaveLength(50)
    const tooMany = [...references, playlist]
    expect(
      Result.isFailure(
        await Effect.runPromise(
          Effect.result(parseDraftMusicReferences({ references: tooMany, primary: null })),
        ),
      ),
    ).toBe(true)

    const full = Schema.decodeUnknownSync(DraftMusicReferenceState)({
      musicReferences: { references, primary: null },
      managed: false,
    })

    for (const change of [
      DraftMusicReferenceChange.cases.Attach.make({
        target: playlist,
        position: 50,
        primary: false,
      }),
      DraftMusicReferenceChange.cases.LegacyPrimary.make({ primary: playlist }),
    ] as const) {
      const result = await Effect.runPromise(
        Effect.result(transitionDraftMusicReferences(full, change)),
      )

      expect(result).toMatchObject({
        failure: { code: 'invalid_input' },
      })
    }

    expect(full.musicReferences.references).toHaveLength(50)
    expect(
      (
        await Effect.runPromise(
          parseDraftMusicReferences({
            references: [album, { ...album, entityType: 'track' }],
            primary: album,
          }),
        )
      ).references,
    ).toHaveLength(2)
  })

  test('legacy selection appends or selects in place; clearing preserves list and marker', async () => {
    const selected = await Effect.runPromise(
      transitionDraftMusicReferences(
        initial,
        DraftMusicReferenceChange.cases.LegacyPrimary.make({
          primary: playlist,
        }),
      ),
    )

    expect(selected).toEqual({
      musicReferences: { references: [track, album, playlist], primary: playlist },
      managed: false,
    })

    const reselected = await Effect.runPromise(
      transitionDraftMusicReferences(
        selected,
        DraftMusicReferenceChange.cases.LegacyPrimary.make({
          primary: { ...album, entityId: album.entityId.toUpperCase() },
        }),
      ),
    )

    expect(reselected.musicReferences).toEqual({
      references: [track, album, playlist],
      primary: album,
    })

    const cleared = await Effect.runPromise(
      transitionDraftMusicReferences(
        reselected,
        DraftMusicReferenceChange.cases.LegacyPrimary.make({
          primary: null,
        }),
      ),
    )

    expect(cleared).toEqual({
      musicReferences: { references: [track, album, playlist], primary: null },
      managed: false,
    })
    expect(initial.musicReferences).toEqual({ references: [track, album], primary: album })
  })

  test('explicit empty replacements mark managed permanently; removal requires valid primary', async () => {
    const empty = await Effect.runPromise(
      transitionDraftMusicReferences(
        initial,
        DraftMusicReferenceChange.cases.Replace.make({
          musicReferences: { references: [], primary: null },
        }),
      ),
    )

    expect(empty).toEqual({ musicReferences: { references: [], primary: null }, managed: true })
    expect(
      (
        await Effect.runPromise(
          transitionDraftMusicReferences(
            empty,
            DraftMusicReferenceChange.cases.LegacyPrimary.make({
              primary: null,
            }),
          ),
        )
      ).managed,
    ).toBe(true)

    const appended = await Effect.runPromise(
      transitionDraftMusicReferences(
        initial,
        DraftMusicReferenceChange.cases.Attach.make({
          target: playlist,
          position: 2,
          primary: false,
        }),
      ),
    )

    expect(appended).toEqual({
      musicReferences: { references: [track, album, playlist], primary: album },
      managed: true,
    })

    const removed = await Effect.runPromise(
      transitionDraftMusicReferences(
        appended,
        DraftMusicReferenceChange.cases.Remove.make({
          target: album,
          primary: playlist,
        }),
      ),
    )

    expect(removed).toEqual({
      musicReferences: { references: [track, playlist], primary: playlist },
      managed: true,
    })

    for (const change of [
      DraftMusicReferenceChange.cases.Remove.make({ target: album, primary: album }),
      DraftMusicReferenceChange.cases.Remove.make({ target: playlist, primary: album }),
      DraftMusicReferenceChange.cases.Attach.make({ target: album, position: 0, primary: true }),
    ] as const) {
      expect(
        Result.isFailure(
          await Effect.runPromise(Effect.result(transitionDraftMusicReferences(initial, change))),
        ),
      ).toBe(true)
    }
  })

  test('attach respects insertion position and explicit primary without promoting list order', async () => {
    const inserted = await Effect.runPromise(
      transitionDraftMusicReferences(
        initial,
        DraftMusicReferenceChange.cases.Attach.make({
          target: playlist,
          position: 1,
          primary: true,
        }),
      ),
    )

    expect(inserted).toEqual({
      musicReferences: { references: [track, playlist, album], primary: playlist },
      managed: true,
    })

    for (const position of [-1, 0.5, 3]) {
      const result = await Effect.runPromise(
        Effect.result(
          Schema.decodeUnknownEffect(DraftMusicReferenceChange.cases.Attach)({
            ...DraftMusicReferenceChange.cases.Attach.make({
              target: playlist,
              position: 0,
              primary: false,
            }),
            position,
          }).pipe(Effect.flatMap((change) => transitionDraftMusicReferences(initial, change))),
        ),
      )

      expect(Result.isFailure(result)).toBe(true)
    }
  })
})
