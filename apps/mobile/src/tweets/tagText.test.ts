import { expect, test } from 'vitest'

import { extractTags, segmentText, stripTags, tagsLine } from './tagText'

test('tags on their own lines leave no blank gaps in the content', () => {
  expect(stripTags('Classic album\n#ambient')).toBe('Classic album')
  expect(stripTags('Top\n\n#a #b\n\nBottom')).toBe('Top\n\nBottom')
  expect(stripTags('#only #tags')).toBe('')
})

test('text segments highlight tags and links without losing characters', () => {
  const text = '#open with https://x.test/a and #close'
  const segments = segmentText(text)
  expect(segments.map(({ value }) => value).join('')).toBe(text)
  expect(segments.filter(({ kind }) => kind !== 'text')).toEqual([
    { kind: 'tag', value: '#open', offset: 0 },
    { kind: 'link', value: 'https://x.test/a', offset: 11 },
    { kind: 'tag', value: '#close', offset: 32 },
  ])
})

test('underscore, camel and hyphen spellings resolve to one existing tag', () => {
  const known = ['hip_hop', 'hip hop', 'jazz']

  for (const token of ['#hip_hop', '#hipHop', '#HipHop', '#hip-hop', '#hiphop'])
    expect(extractTags(`a ${token}`, known)).toEqual(['hip hop'])
})

test('new tags are stored lowercase with underscores as spaces, and deduplicated by key', () => {
  expect(extractTags('#Deep_House #deephouse #DnB', [])).toEqual(['deep house', 'dnb'])
})

test('editing writes stored tags back as single tokens', () => {
  expect(tagsLine(['hip hop', 'jazz'])).toBe('#hip_hop #jazz')
  expect(extractTags(tagsLine(['hip hop', 'jazz']), ['hip hop'])).toEqual(['hip hop', 'jazz'])
})
