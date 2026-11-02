import { Effect } from 'effect'
import { expect, test } from 'vitest'

import {
  appendSharedText,
  CONTENT_MAX_LENGTH,
  draftError,
  emptyTweetDraft,
  parseSharedText,
  postPayload,
} from './draft'

test('text and URL shares preserve content, order and remove exact duplicates', async () => {
  const text = await Effect.runPromise(
    parseSharedText([
      { shareType: 'text', value: ' Listen to this ' },
      { shareType: 'url', value: 'https://example.test/album' },
      { shareType: 'url', value: 'https://example.test/album' },
    ]),
  )

  expect(text).toBe('Listen to this\n\nhttps://example.test/album')
})

test('unsupported, empty, malformed and oversized shares fail without discarding content', async () => {
  for (const payload of [
    [],
    [{ shareType: 'image', value: 'file:///image.jpg' }],
    [{ shareType: 'text', value: '' }],
    [{ shareType: 'url', value: 12 }],
    [{ shareType: 'text', value: 'a'.repeat(CONTENT_MAX_LENGTH + 1) }],
  ]) {
    expect(await Effect.runPromise(parseSharedText(payload).pipe(Effect.isFailure))).toBe(true)
  }
})

test('short shares become the tweet and long shares become the body without truncation', () => {
  const empty = emptyTweetDraft('fixed-id')
  expect(appendSharedText(empty, 'a'.repeat(255)).title).toHaveLength(255)
  expect(appendSharedText(empty, 'a'.repeat(256))).toEqual({ ...empty, content: 'a'.repeat(256) })
})

test('a new share appends to the existing draft without replacing its identity or attachment', () => {
  const draft = {
    ...emptyTweetDraft('fixed-id'),
    title: 'Already writing',
    content: 'Existing body',
    remote: true,
    music: { entityType: 'track' as const, entityId: 'track-id', title: 'Track' },
  }

  expect(appendSharedText(draft, 'https://example.test')).toEqual({
    ...draft,
    content: 'Existing body\n\nhttps://example.test',
  })
})

test('publishing and private saves use the same stable slug and normalized content', () => {
  const draft = {
    ...emptyTweetDraft('fixed-id'),
    title: ' A record ',
    content: ' Body ',
    tags: ' jazz, ,new music, jazz ',
  }

  expect(postPayload(draft, true)).toEqual({
    type: 'micro',
    slug: 'mobile-fixed-id',
    title: 'A record',
    content: 'Body',
    tags: ['jazz', 'new music'],
    draft: false,
    musicEntityType: null,
    musicEntityId: null,
  })
  expect(postPayload(draft, false)).toEqual({ ...postPayload(draft, true), draft: true })
})

test('validation matches the web tweet limit and allows a body-only tweet', () => {
  const draft = emptyTweetDraft('fixed-id')
  expect(draftError(draft)).not.toBeNull()
  expect(draftError({ ...draft, title: 'a'.repeat(255) })).toBeNull()
  expect(draftError({ ...draft, title: 'a'.repeat(256) })).not.toBeNull()
  expect(draftError({ ...draft, content: 'Body only' })).toBeNull()
  expect(draftError({ ...draft, content: 'a'.repeat(CONTENT_MAX_LENGTH + 1) })).not.toBeNull()
})
