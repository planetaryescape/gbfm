import { Effect } from 'effect'
import { expect, test } from 'vitest'

import {
  appendSharedText,
  CONTENT_MAX_LENGTH,
  draftError,
  emptyTweetDraft,
  musicCandidate,
  normalizeStoredDraft,
  parseSharedText,
  postPayload,
  replyError,
  replyPayload,
  TWEET_MAX_LENGTH,
  tweetLength,
  withText,
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

test('shares append to the single tweet text', () => {
  const empty = emptyTweetDraft('fixed-id')
  expect(appendSharedText(empty, 'Listen').text).toBe('Listen')
  expect(appendSharedText({ ...empty, text: 'Already writing' }, 'https://example.test').text).toBe(
    'Already writing\n\nhttps://example.test',
  )
})

test('a share keeps the draft identity and a manually attached record', () => {
  const draft = {
    ...emptyTweetDraft('fixed-id'),
    text: 'Already writing',
    remote: true,
    music: {
      entityType: 'track' as const,
      entityId: 'track-id',
      title: 'Track',
      url: null,
      coverImageUrl: null,
    },
  }

  expect(appendSharedText(draft, 'more')).toEqual({ ...draft, text: 'Already writing\n\nmore' })
})

test('removing the music link from the text drops its card and its dismissal', () => {
  const link = 'https://open.spotify.com/album/abc'

  const draft = {
    ...emptyTweetDraft('fixed-id'),
    text: `Spinning ${link}`,
    music: {
      entityType: 'album' as const,
      entityId: 'album-id',
      title: 'Album',
      url: link,
      coverImageUrl: null,
    },
  }

  expect(withText(draft, `Spinning ${link} again`).music).toEqual(draft.music)
  expect(withText(draft, 'Spinning').music).toBeNull()
  expect(withText({ ...draft, music: null, dismissedMusicUrl: link }, 'x').dismissedMusicUrl).toBe(
    null,
  )
})

test('the first link becomes the music candidate unless dismissed or already attached', () => {
  const draft = {
    ...emptyTweetDraft('fixed-id'),
    text: 'a https://x.test/one. b https://x.test/two',
  }

  expect(musicCandidate(draft)).toBe('https://x.test/one')
  expect(musicCandidate({ ...draft, dismissedMusicUrl: 'https://x.test/one' })).toBeNull()
  expect(musicCandidate({ ...draft, text: 'no links' })).toBeNull()
})

test('hashtags are read inline, deduplicated, and moved out of the content', () => {
  const draft = {
    ...emptyTweetDraft('fixed-id'),
    text: ' New #jazz from #Lagos, more #JAZZ. Not a#tag ',
  }

  expect(postPayload(draft, true)).toEqual({
    type: 'micro',
    slug: 'mobile-fixed-id',
    title: null,
    content: 'New from, more. Not a#tag',
    tags: ['jazz', 'lagos'],
    draft: false,
    musicEntityType: null,
    musicEntityId: null,
  })
  expect(postPayload(draft, false)).toEqual({ ...postPayload(draft, true), draft: true })
})

test('a recognised music link is kept out of the saved content unless it is all there is', () => {
  const link = 'https://open.spotify.com/track/abc'

  const music = {
    entityType: 'track' as const,
    entityId: 'track-id',
    title: 'Track',
    url: link,
    coverImageUrl: null,
  }

  const draft = { ...emptyTweetDraft('fixed-id'), text: `Classic ${link}\n#ambient`, music }

  expect(postPayload(draft, true).content).toBe('Classic')
  expect(postPayload({ ...draft, text: `${link} #ambient` }, true).content).toBe(link)
  expect(postPayload({ ...draft, music: null }, true).content).toBe(`Classic ${link}`)
})

test('length counts links as a fixed weight and validation enforces the short form', () => {
  const draft = emptyTweetDraft('fixed-id')
  expect(tweetLength(`hi https://open.spotify.com/track/${'a'.repeat(80)}`)).toBe(26)
  expect(draftError(draft)).not.toBeNull()
  expect(draftError({ ...draft, text: 'a'.repeat(TWEET_MAX_LENGTH) })).toBeNull()
  expect(draftError({ ...draft, text: 'a'.repeat(TWEET_MAX_LENGTH + 1) })).not.toBeNull()
})

test('legacy drafts merge title, body and tags into one text', () => {
  expect(
    normalizeStoredDraft({
      slug: 'mobile-old',
      title: 'Title',
      content: 'Body',
      tags: 'jazz, new music',
      remote: true,
      music: { entityType: 'track', entityId: 't', title: 'T' },
    }),
  ).toEqual({
    slug: 'mobile-old',
    text: 'Title\n\nBody\n\n#jazz #newmusic',
    remote: true,
    music: { entityType: 'track', entityId: 't', title: 'T', url: null, coverImageUrl: null },
    dismissedMusicUrl: null,
  })
})

test('replies keep hashtags as text and drop an attached music link', () => {
  const link = 'https://open.spotify.com/album/abc'

  const draft = {
    ...emptyTweetDraft('reply'),
    text: `Agreed #dub ${link}`,
    music: {
      entityType: 'album' as const,
      entityId: 'album-id',
      title: 'Album',
      url: link,
      coverImageUrl: null,
    },
  }

  expect(replyPayload(draft)).toEqual({
    content: 'Agreed #dub',
    musicEntityType: 'album',
    musicEntityId: 'album-id',
  })
  expect(replyError(draft)).toBe(null)
})

test('an empty reply is rejected', () => {
  expect(replyError({ ...emptyTweetDraft('reply'), text: '   ' })).toBe('Write a reply.')
})
