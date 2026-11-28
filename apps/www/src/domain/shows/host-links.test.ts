/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- Structural expectations intentionally describe the public tagged result. */
import type { RichContentDocument } from '@gbfm/rich-content/schema'
import { describe, expect, it } from 'vitest'

import { linkHostMentions } from './host-links'

const paragraph = (value: string): RichContentDocument => ({
  version: 1,
  blocks: [{ _tag: 'Paragraph', children: [{ _tag: 'Text', value }] }],
})

const kimetsu = { name: '[kimetsu.]', username: 'kimetsu' }

describe('linkHostMentions', () => {
  it('links every mention of a host to their profile', () => {
    const linked = linkHostMentions(
      paragraph('curated by [kimetsu.], a South African artist. [kimetsu.]’s practice'),
      [kimetsu],
    )

    expect(linked.blocks).toEqual([
      {
        _tag: 'Paragraph',
        children: [
          { _tag: 'Text', value: 'curated by ' },
          {
            _tag: 'Link',
            href: '/kimetsu',
            title: null,
            children: [{ _tag: 'Text', value: '[kimetsu.]' }],
          },
          { _tag: 'Text', value: ', a South African artist. ' },
          {
            _tag: 'Link',
            href: '/kimetsu',
            title: null,
            children: [{ _tag: 'Text', value: '[kimetsu.]' }],
          },
          { _tag: 'Text', value: '’s practice' },
        ],
      },
    ])
  })

  it('leaves existing links alone', () => {
    const document: RichContentDocument = {
      version: 1,
      blocks: [
        {
          _tag: 'Paragraph',
          children: [
            {
              _tag: 'Link',
              href: '/elsewhere',
              title: null,
              children: [{ _tag: 'Text', value: '[kimetsu.]' }],
            },
          ],
        },
      ],
    }

    expect(linkHostMentions(document, [kimetsu])).toEqual(document)
  })

  it('does nothing for hosts without a username', () => {
    const document = paragraph('hosted by Guide Fari')

    expect(linkHostMentions(document, [{ name: 'Guide Fari', username: null }])).toEqual(document)
  })
})
