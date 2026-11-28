import { describe, expect, it } from 'vitest'

import { musicMentions } from './music-mentions'

describe('musicMentions', () => {
  it('connects case-insensitive title mentions without changing their text ranges', () => {
    expect(
      musicMentions('Try Flowers In The Dark, then Switchboard by Armand Hammer.', [
        'Flowers In The Dark',
        'Switchboard',
      ]),
    ).toEqual([
      { start: 4, end: 23, reference: 0 },
      { start: 30, end: 41, reference: 1 },
    ])
  })

  it('prefers the complete title and does not match titles inside unrelated words', () => {
    expect(musicMentions('Darkness. In the dark. Dark.', ['Dark', 'In The Dark'])).toEqual([
      { start: 10, end: 21, reference: 1 },
      { start: 23, end: 27, reference: 0 },
    ])
  })

  it('treats punctuation literally and allows whitespace between title words', () => {
    expect(
      musicMentions('Play A+B (Live), then flowers\nin the dark.', [
        'A+B (Live)',
        'Flowers In The Dark',
      ]),
    ).toEqual([
      { start: 5, end: 15, reference: 0 },
      { start: 22, end: 41, reference: 1 },
    ])
  })

  it('leaves ambiguous titles and unrelated prose unlinked', () => {
    expect(musicMentions('Promises and silence.', ['Promises', 'promises'])).toEqual([])
    expect(musicMentions('Other records.', ['Flowers In The Dark'])).toEqual([])
    expect(musicMentions('Other records.', [])).toEqual([])
  })
})
