import { describe, expect, it } from 'vitest'

import { skipsSeenTweets } from '../../features/reader/location'

describe('tweet read-mode cookie', () => {
  it('defaults to skipping seen tweets without accepting a similarly named cookie', () => {
    expect(skipsSeenTweets(null)).toBe(true)
    expect(skipsSeenTweets('other-gbfm-tweet-read-mode=all')).toBe(true)
    expect(skipsSeenTweets('gbfm-tweet-read-mode=invalid')).toBe(true)
  })
  it('reads the explicit mode among unrelated cookies', () => {
    expect(skipsSeenTweets('session=fixture; gbfm-tweet-read-mode=all; other=unread')).toBe(false)
    expect(skipsSeenTweets('session=fixture; gbfm-tweet-read-mode=unread')).toBe(true)
  })
})
