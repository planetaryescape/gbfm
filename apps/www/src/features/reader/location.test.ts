import { describe, expect, it } from '@effect/vitest'

import { concreteSlug, isEntry, parseCheckpoint, readModeCookie, skipsSeenTweets } from './location'

describe('reader HTTP location contracts', () => {
  it('recognises reader entry aliases, but never treats a search as an entry visit', () => {
    expect(isEntry('/tweets')).toBe(true)
    expect(isEntry('/tweet#reading')).toBe(true)
    expect(isEntry(new URL('https://goosebumps.fm/tweets'))).toBe(true)
    expect(isEntry('/tweets?q=')).toBe(false)
    expect(isEntry('/tweets?q=music')).toBe(false)
    expect(isEntry('/tweet/latest')).toBe(false)
  })

  it('decodes concrete URLs while rejecting aliases, malformed escapes and unsafe checkpoints', () => {
    expect(concreteSlug('/tweet/hello%20world')).toBeNull()
    expect(concreteSlug('/tweet/music%3Fprivate')).toBeNull()
    expect(concreteSlug('/tweet/%E0%A4%A')).toBeNull()
    expect(concreteSlug('/tweet/latest')).toBeNull()
    expect(concreteSlug('/tweet/new')).toBeNull()
    expect(concreteSlug('/tweet/safe-slug?random=failed')).toBe('safe-slug')
    expect(concreteSlug(new URL('https://goosebumps.fm/tweet/caf%C3%A9'))).toBe('café')

    for (const value of [
      '',
      '.',
      '..',
      '/tweet/a',
      'a/b',
      'a?b',
      'a#b',
      'a\\b',
      'a\n',
      'latest',
      'new',
    ])
      expect(parseCheckpoint(value)).toBeNull()
    expect(parseCheckpoint('a'.repeat(513))).toBeNull()
    expect(parseCheckpoint('safe-slug')).toBe('safe-slug')
  })

  it('keeps the existing read-mode cookie name, defaults and first-match semantics', () => {
    expect(readModeCookie).toBe('gbfm-tweet-read-mode')
    expect(skipsSeenTweets(null)).toBe(true)
    expect(skipsSeenTweets('other=all')).toBe(true)
    expect(skipsSeenTweets(`other=value; ${readModeCookie}=all`)).toBe(false)
    expect(skipsSeenTweets(`${readModeCookie}=unread`)).toBe(true)
    expect(skipsSeenTweets(`${readModeCookie}=invalid; ${readModeCookie}=all`)).toBe(true)
  })
})
