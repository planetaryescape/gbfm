import { expect, test } from 'vitest'

import { animatePageTransition } from './navigation-transition'

test('tweet-to-tweet navigation remains immediately interactive instead of animating a document snapshot', () => {
  expect(animatePageTransition('/tweet/one', '/tweet/two')).toBe(false)
  expect(animatePageTransition('/tweet/one', '/tweet/one')).toBe(false)
})

test('entering, leaving, and navigating other sections preserve page transitions', () => {
  expect(animatePageTransition('/', '/tweet/one')).toBe(true)
  expect(animatePageTransition('/tweet/one', '/about')).toBe(true)
  expect(animatePageTransition('/shows', '/shows/radio')).toBe(true)
  expect(animatePageTransition('/shows', '/shows')).toBe(false)
})
