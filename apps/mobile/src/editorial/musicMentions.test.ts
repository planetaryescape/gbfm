import { describe, expect, it } from 'vitest'

import { mentionSegments, musicMentions } from './musicMentions'

describe('musicMentions', () => {
  it('finds whole-word, case-insensitive titles and prefers the longest', () => {
    const text = 'Congress is a classic. Marima Nzara is another one, unlike Marima.'

    expect(musicMentions(text, ['Marima', 'Marima Nzara', 'Congress'])).toEqual([
      { start: 0, end: 8, reference: 2 },
      { start: 23, end: 35, reference: 1 },
      { start: 59, end: 65, reference: 0 },
    ])
  })

  it('skips titles shared by more than one record', () => {
    expect(musicMentions('Stimela again', ['Stimela', 'stimela'])).toEqual([])
  })
})

describe('mentionSegments', () => {
  it('splits prose around mentions without losing text', () => {
    const text = 'Congress is a classic. Disaster too.'
    const segments = mentionSegments(text, musicMentions(text, ['Congress', 'Disaster']))

    expect(segments).toEqual([
      { start: 0, text: 'Congress', reference: 0 },
      { start: 8, text: ' is a classic. ', reference: null },
      { start: 23, text: 'Disaster', reference: 1 },
      { start: 31, text: ' too.', reference: null },
    ])
    expect(segments.map((segment) => segment.text).join('')).toBe(text)
  })
})
