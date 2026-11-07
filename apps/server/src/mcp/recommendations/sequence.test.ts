import { expect, test } from 'vitest'

import { proposeAlbumBlocks, type SequenceMember } from './sequence'

test('album blocks preserve every member and keep original ties, unknowns and first occurrences', () => {
  const members: Array<SequenceMember> = [
    { trackId: 'a3', position: 0, albumId: 'a', trackNumber: 3 },
    { trackId: 'b1', position: 1, albumId: 'b', trackNumber: 1 },
    { trackId: 'a1', position: 2, albumId: 'a', trackNumber: 1 },
    { trackId: 'singleton', position: 3, albumId: null, trackNumber: 1 },
    { trackId: 'b-null', position: 4, albumId: 'b', trackNumber: null },
    { trackId: 'a-zero', position: 5, albumId: 'a', trackNumber: 0 },
    { trackId: 'a-tie', position: 6, albumId: 'a', trackNumber: 1 },
    { trackId: 'b2', position: 7, albumId: 'b', trackNumber: 2 },
  ]

  const result = proposeAlbumBlocks(members)
  expect(result.proposed).toEqual([
    'a1',
    'a-tie',
    'a3',
    'a-zero',
    'b1',
    'b2',
    'b-null',
    'singleton',
  ])
  expect(result.proposed.toSorted()).toEqual(members.map((member) => member.trackId).toSorted())
  expect(result.status).toBe('sufficient')
  expect(result.changed).toBe(true)
  expect(result.blocks[0]?.map((member) => member.position)).toEqual([0, 2, 5, 6])
})

test('supported unchanged order differs from insufficient evidence', () => {
  const a: SequenceMember = { trackId: 'a', position: 0, albumId: 'album', trackNumber: 1 }
  const b: SequenceMember = { trackId: 'b', position: 1, albumId: 'album', trackNumber: 2 }
  expect(proposeAlbumBlocks([a, b])).toMatchObject({
    status: 'sufficient',
    changed: false,
    proposed: ['a', 'b'],
  })
  expect(proposeAlbumBlocks([a, { ...b, albumId: null }])).toMatchObject({
    status: 'insufficient_evidence',
    changed: false,
    proposed: ['a', 'b'],
  })
  expect(proposeAlbumBlocks([])).toMatchObject({
    status: 'insufficient_evidence',
    changed: false,
    proposed: [],
  })
})
