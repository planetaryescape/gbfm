import { Schema } from 'effect'
import { expect, test } from 'vitest'

import {
  CreateCollectionInput,
  ListeningVersion,
  SaveMixInput,
  SetCollectionMembershipInput,
  SetListeningStatusInput,
  UpdateCollectionInput,
  UpdateListeningNotesInput,
} from './contracts'

const requestId = 'a1234567-1234-4234-8234-123456789012'

test('six gated command contracts reject publication and owner overrides; updates require versions', () => {
  const commands = [
    {
      schema: SaveMixInput,
      input: { requestId, url: 'https://soundcloud.com/test/mix', title: 'Mix' },
    },
    { schema: CreateCollectionInput, input: { requestId, title: 'Private' } },
    {
      schema: UpdateListeningNotesInput,
      input: { requestId, mixId: 'mix', expectedVersion: 'revision:1', notes: '' },
    },
    {
      schema: SetListeningStatusInput,
      input: { requestId, mixId: 'mix', expectedVersion: 'revision:1', status: 'listened' },
    },
    {
      schema: UpdateCollectionInput,
      input: {
        requestId,
        collectionId: 'collection',
        expectedVersion: 'revision:1',
        description: '',
      },
    },
    {
      schema: SetCollectionMembershipInput,
      input: {
        requestId,
        collectionId: 'collection',
        mixId: 'mix',
        expectedVersion: 'revision:1',
        included: false,
      },
    },
  ]

  for (const { schema, input } of commands) {
    const parse = Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })
    expect(parse(input)).toEqual(input)
    expect(() => parse({ ...input, published: true })).toThrow()
    expect(() => parse({ ...input, userId: 'victim' })).toThrow()
    expect(() => parse({ ...input, requestId: 'not-a-uuid' })).toThrow()
  }

  for (const { schema, input } of commands.filter(({ input }) => 'expectedVersion' in input)) {
    const parse = Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })
    expect(() => parse({ ...input, expectedVersion: undefined })).toThrow()
  }

  expect(() =>
    Schema.decodeUnknownSync(UpdateCollectionInput)({
      requestId,
      collectionId: 'collection',
      expectedVersion: 'revision:1',
    }),
  ).toThrow()
})

test('command versions are canonical positive safe integers, including the storage ceiling', () => {
  const parse = Schema.decodeUnknownSync(ListeningVersion)

  for (const version of ['revision:1', 'revision:14', 'revision:9007199254740991']) {
    expect(parse(version)).toBe(version)
  }

  for (const version of [
    'revision:0',
    'revision:-1',
    'revision:01',
    'revision:1.0',
    'revision:1e3',
    'revision:9007199254740992',
    ' revision:1',
    'revision:1\n',
    'revision:1x',
    1,
    null,
  ]) {
    expect(() => parse(version)).toThrow()
  }
})
