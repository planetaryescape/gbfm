import { expect, test } from 'vitest'

import { activeTag, insertTag, MAX_TAG_SUGGESTIONS, suggestTags } from './tagSuggestions'

test('the tag under the cursor is active, including mid-word edits', () => {
  expect(activeTag('new #ja', 7)).toEqual({ start: 4, end: 7, query: 'ja' })
  expect(activeTag('#', 1)).toEqual({ start: 0, end: 1, query: '' })
  expect(activeTag('new #jazz today', 7)).toEqual({ start: 4, end: 9, query: 'ja' })
  expect(activeTag('new #jazz today', 15)).toBeNull()
  expect(activeTag('email a#b', 9)).toBeNull()
})

test('prefix matches come first, used and exact tags are skipped, results are capped', () => {
  const known = ['afrojazz', 'jazz', 'Jazzfunk', 'house', 'jazzhop', 'ja1', 'ja2', 'ja3', 'ja4']

  expect(suggestTags(known, 'jazz', ['jazzhop'])).toEqual(['Jazzfunk', 'afrojazz'])
  expect(suggestTags(known, 'ja', [])).toHaveLength(MAX_TAG_SUGGESTIONS)
  expect(suggestTags(known, 'ja', [])[0]).toBe('jazz')
})

test('suggestions match across spellings and insert the editable token', () => {
  expect(suggestTags(['hip hop', 'hip_hop', 'house'], 'hipH', [])).toEqual(['hip hop'])
  expect(insertTag('#hipH', { start: 0, end: 5, query: 'hipH' }, 'hip hop').text).toBe('#hip_hop ')
})

test('picking a tag replaces the whole token and places the cursor after one space', () => {
  expect(insertTag('new #ja', { start: 4, end: 7, query: 'ja' }, 'jazz')).toEqual({
    text: 'new #jazz ',
    cursor: 10,
  })
  expect(insertTag('new #jaz today', { start: 4, end: 8, query: 'ja' }, 'jazz')).toEqual({
    text: 'new #jazz today',
    cursor: 10,
  })
})
