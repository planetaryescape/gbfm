import { expect, test } from 'vitest'

import { videoNavigationAllowed, videoWatchUrl } from './videoNavigation'

test.each([
  'about:blank',
  'about:srcdoc',
  'https://goosebumps.fm/',
  'https://www.youtube-nocookie.com/embed/fixture?autoplay=1',
])('allows the inline player document and its own embed: %s', (url) => {
  expect(videoNavigationAllowed(url, 'fixture')).toBe(true)
})

test.each([
  'https://www.youtube.com/watch?v=fixture',
  'https://www.youtube.com/@channel',
  'https://consent.youtube.com/',
  'https://www.youtube-nocookie.com/embed/different',
  'https://www.youtube-nocookie.com.evil.example/embed/fixture',
  'https://user:pass@www.youtube-nocookie.com/embed/fixture',
  'https://goosebumps.fm/other-page',
  'javascript:alert(1)',
  'intent://youtube',
  'about:other',
  'not a url',
])('keeps player navigation bounded without external launch: %s', (url) => {
  expect(videoNavigationAllowed(url, 'fixture')).toBe(false)
})

test.each([
  'https://www.youtube.com/watch?v=fixture&t=90&list=playlist',
  'https://youtu.be/fixture?t=90',
])('the deliberate watch action retains the authored safe URL: %s', (url) => {
  expect(videoWatchUrl(url, 'fixture')).toBe(url)
})

test.each([
  'javascript:alert(1)',
  'https://evil.example/watch?v=fixture',
  'https://www.youtube.com/watch?v=different',
  'http://youtu.be/fixture',
  'https://user:pass@youtu.be/fixture',
])('does not launch an unsafe or unrelated canonical URL: %s', (url) => {
  expect(videoWatchUrl(url, 'fixture')).toBe('https://www.youtube.com/watch?v=fixture')
})
