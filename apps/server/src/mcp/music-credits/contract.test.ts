import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  checkAliasReplacement,
  checkCreditReplacement,
  parseArtistAliases,
  parseRecordingCredits,
} from './contract'

const targetId = '00000000-0000-4000-8000-000000000001'

const artistId = '00000000-0000-4000-8000-000000000002'

const rowId = '00000000-0000-4000-8000-000000000003'

const base = { requestId: targetId, expectedVersion: `music:sha256:${'a'.repeat(64)}` }

const evidence = { sourceLabel: 'Sleeve', evidenceNote: 'Page 2' }

const performer = { creditedName: 'Echo', role: 'performer', ...evidence }

const credits = (items: ReadonlyArray<unknown>) => ({
  ...base,
  target: { type: 'track', id: targetId },
  credits: items,
})

const aliases = (items: ReadonlyArray<unknown>) => ({ ...base, artistId, aliases: items })

const errorCode = <A, E extends { readonly code: string }>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => 'ok' })),
  )

describe('M2 complete collection inputs', () => {
  it('trims display values, preserves names and separates instruments from other roles', async () => {
    const input = await Effect.runPromise(
      parseRecordingCredits(
        credits([
          { ...performer, creditedName: '  Écho  ' },
          { ...performer, role: 'instrument', instrument: ' Bass ' },
        ]),
      ),
    )

    expect(input.credits[0]?.creditedName).toBe('Écho')
    expect(input.credits[1]?.instrument).toBe('Bass')
    expect(
      await errorCode(parseRecordingCredits(credits([{ ...performer, instrument: 'Bass' }]))),
    ).toBe('invalid_input')
    expect(
      await errorCode(parseRecordingCredits(credits([{ ...performer, role: 'instrument' }]))),
    ).toBe('invalid_input')
    expect(
      await errorCode(parseRecordingCredits(credits([{ ...performer, creditedName: '\nEcho' }]))),
    ).toBe('invalid_input')
  })

  it('accepts explicit clears and 50 items, rejects missing/null arrays, 51 and unknown nested fields', async () => {
    expect(await errorCode(parseRecordingCredits(credits([])))).toBe('ok')
    expect(await errorCode(parseArtistAliases(aliases([])))).toBe('ok')
    expect(
      await errorCode(
        parseRecordingCredits(
          credits(
            Array.from({ length: 50 }, (_, index) => ({
              ...performer,
              creditedName: `Player ${index}`,
            })),
          ),
        ),
      ),
    ).toBe('ok')
    expect(
      await errorCode(
        parseRecordingCredits(
          credits(
            Array.from({ length: 51 }, (_, index) => ({
              ...performer,
              creditedName: `Player ${index}`,
            })),
          ),
        ),
      ),
    ).toBe('invalid_input')

    for (const value of [undefined, null]) {
      expect(await errorCode(parseRecordingCredits({ ...credits([]), credits: value }))).toBe(
        'invalid_input',
      )
    }

    expect(
      await errorCode(parseRecordingCredits(credits([{ ...performer, assertedById: artistId }]))),
    ).toBe('invalid_input')
    expect(
      await errorCode(
        parseRecordingCredits({
          ...credits([]),
          target: { type: 'track', id: targetId, private: true },
        }),
      ),
    ).toBe('invalid_input')
    expect(
      await errorCode(
        parseRecordingCredits({
          requestId: targetId,
          target: { type: 'track', id: targetId },
          credits: [],
        }),
      ),
    ).toBe('precondition_required')
  })

  it('bounds raw encoded bytes and code points without rejecting astral names', async () => {
    expect(
      await errorCode(
        parseRecordingCredits(credits([{ ...performer, creditedName: '🎷'.repeat(200) }])),
      ),
    ).toBe('ok')
    expect(
      await errorCode(
        parseRecordingCredits(credits([{ ...performer, creditedName: '🎷'.repeat(201) }])),
      ),
    ).toBe('invalid_input')

    const input = credits(
      Array.from({ length: 50 }, (_, index) => ({
        ...performer,
        creditedName: `Name ${index}`,
        evidenceNote: '界'.repeat(1000),
      })),
    )

    expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeGreaterThan(128 * 1024)
    expect(await errorCode(parseRecordingCredits(input))).toBe('invalid_input')
  })

  it('requires public attribution syntax without fetching a source', async () => {
    for (const sourceUrl of [
      'http://127.1/sleeve',
      'http://10.0.0.1/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fec0::1]/sleeve',
      'http://[feff::1]/sleeve',
      'https://example.com/?token=x',
      'https://example.com/#x',
      'https://user:pass@example.com/',
      'file:///sleeve',
    ]) {
      expect(
        await errorCode(
          parseArtistAliases(aliases([{ name: 'Echo', sourceLabel: 'Sleeve', sourceUrl }])),
        ),
      ).toBe('invalid_input')
    }

    expect(
      await errorCode(
        parseArtistAliases(
          aliases([
            { name: 'Echo', sourceLabel: 'Sleeve', sourceUrl: 'https://example.com/sleeve' },
          ]),
        ),
      ),
    ).toBe('ok')
    expect(
      await errorCode(
        parseArtistAliases(
          aliases([
            {
              name: 'Echo',
              sourceLabel: 'Sleeve',
              sourceUrl: 'https://[2001:4860:4860::8888]/sleeve',
            },
          ]),
        ),
      ),
    ).toBe('ok')
    expect(
      await errorCode(parseArtistAliases(aliases([{ name: 'Echo', sourceLabel: 'Sleeve' }]))),
    ).toBe('invalid_input')
    expect(
      await errorCode(
        parseArtistAliases(aliases([{ name: 'Echo', ...evidence, evidenceNote: null }])),
      ),
    ).toBe('invalid_input')
  })

  it('requires explicit unlink intent and rejects foreign row IDs', async () => {
    const existing = [{ id: rowId, artistId }]

    for (const item of [
      { ...performer, id: rowId },
      { ...performer, id: targetId, artistId },
    ]) {
      const input = await Effect.runPromise(parseRecordingCredits(credits([item])))
      expect(await errorCode(checkCreditReplacement(input, existing))).toBe('invalid_input')
    }

    const input = await Effect.runPromise(
      parseRecordingCredits(credits([{ ...performer, id: rowId, artistId: null }])),
    )

    expect(await errorCode(checkCreditReplacement(input, existing))).toBe('ok')
    expect(await errorCode(checkCreditReplacement(input, [{ id: rowId, artistId: null }]))).toBe(
      'invalid_input',
    )
    expect(
      await errorCode(parseRecordingCredits(credits([{ ...performer, artistId: null }]))),
    ).toBe('invalid_input')
    expect(
      await errorCode(
        parseRecordingCredits(
          credits([
            { ...performer, id: rowId },
            { ...performer, id: rowId, role: 'engineer' },
          ]),
        ),
      ),
    ).toBe('invalid_input')
  })

  it('compares explicit IDs or normalized names, never merges name-only and linked participants', async () => {
    const distinct = await Effect.runPromise(
      parseRecordingCredits(
        credits([
          { ...performer, artistId },
          performer,
          { ...performer, artistId, role: 'producer' },
          { ...performer, artistId, role: 'instrument', instrument: 'Bass' },
          { ...performer, artistId, role: 'instrument', instrument: 'Piano' },
        ]),
      ),
    )

    expect(await errorCode(checkCreditReplacement(distinct, []))).toBe('ok')

    const duplicate = await errorCode(
      parseRecordingCredits(
        credits([
          { ...performer, creditedName: 'Écho' },
          { ...performer, creditedName: 'E\u0301CHO' },
        ]),
      ),
    )

    expect(duplicate).toBe('invalid_input')
  })

  it('rejects primary-name/duplicate alias collisions but preserves accents', async () => {
    const input = await Effect.runPromise(
      parseArtistAliases(aliases([{ name: '  Écho  ', ...evidence }])),
    )

    expect(await errorCode(checkAliasReplacement(input, 'Echo', []))).toBe('ok')
    expect(await errorCode(checkAliasReplacement(input, 'E\u0301CHO', []))).toBe('invalid_input')

    const duplicate = await errorCode(
      parseArtistAliases(
        aliases([
          { name: 'Other   Name', ...evidence },
          { name: 'other name', ...evidence },
        ]),
      ),
    )

    expect(duplicate).toBe('invalid_input')
  })
})
