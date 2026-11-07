import { Effect, Schema } from 'effect'
import { expect, test } from 'vitest'

import { musicFactNameKey } from '@/services/music-entity/name-key'

import { MusicEditCommand } from './commands'
import { MusicVersion, musicVersion } from './version'

test('a guarded command requires a request key and finite safe observed revision', () => {
  const decode = Schema.decodeUnknownSync(MusicEditCommand, { onExcessProperty: 'error' })

  const valid = {
    requestId: '581ed0d1-d905-400d-9aee-7402ceccbc91',
    expectedRevision: 7,
    references: [],
    change: { operation: 'set_album_type', entityId: 'album', albumType: null },
  }

  expect(decode(valid)).toEqual(valid)

  for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, '7']) {
    expect(() => decode({ ...valid, expectedRevision })).toThrow()
  }

  expect(() => decode({ ...valid, requestId: 'retry' })).toThrow()
  expect(() => decode({ ...valid, unexpected: true })).toThrow()

  const relation = {
    ...valid,
    change: { operation: 'set_track_album', entityId: 'track', albumId: 'album' },
  }

  expect(() => decode(relation)).toThrow()
  expect(() =>
    decode({
      ...relation,
      references: [{ entityType: 'artist', entityId: 'album', expectedRevision: 0 }],
    }),
  ).toThrow()
  expect(
    decode({
      ...relation,
      references: [{ entityType: 'album', entityId: 'album', expectedRevision: 0 }],
    }),
  ).toMatchObject({ references: [{ expectedRevision: 0 }] })
  expect(() =>
    decode({
      ...valid,
      references: [{ entityType: 'album', entityId: 'album', expectedRevision: 0 }],
    }),
  ).toThrow()
})

test('opaque music versions bind the same integer revision to resource type and ID', async () => {
  const base = { entityType: 'artist', entityId: 'a', revision: 7 } as const
  const token = await Effect.runPromise(musicVersion(base))
  expect(Schema.decodeUnknownSync(MusicVersion)(token)).toBe(token)
  expect(await Effect.runPromise(musicVersion({ ...base }))).toBe(token)

  for (const observation of [
    { ...base, entityId: 'b' },
    { ...base, entityType: 'album' as const },
    { ...base, revision: 8 },
  ]) {
    expect(await Effect.runPromise(musicVersion(observation))).not.toBe(token)
  }
})

test('alias name equality composes Unicode and whitespace without folding accents or punctuation', () => {
  expect(musicFactNameKey('  E\u0301CHO\t  Live\n')).toBe('écho live')
  expect(musicFactNameKey('Écho Live')).toBe('écho live')
  expect(musicFactNameKey('Echo Live')).not.toBe(musicFactNameKey('Écho Live'))
  expect(musicFactNameKey('Echo-Live')).not.toBe(musicFactNameKey('Echo Live'))
})
