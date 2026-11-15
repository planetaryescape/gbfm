import { Block, type RichContentBlock } from '@gbfm/rich-content/schema'
import { Data, Predicate, Schema } from 'effect'
import { act, createElement } from 'react'
import { createRoot } from 'test-renderer'
import { expect, test } from 'vitest'

import { SpotlightBlockFlow } from './SpotlightBlockFlow'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const decode = Schema.decodeUnknownSync(Block)

const Blocks = Data.taggedEnum<RichContentBlock>()

const record = (title: string) =>
  decode(
    Blocks.MusicEmbed({
      music: {
        entityType: 'album',
        entityId: title,
        title,
        artists: [],
        description: null,
        imageUrl: null,
        canonicalUrl: 'https://example.com/album',
        links: [],
        tracks: [],
      },
      genres: [],
      blurb: null,
      showTracks: false,
    }),
  )

const media = decode(
  Blocks.ExternalMediaEmbed({
    provider: 'youtube',
    title: 'Video',
    canonicalUrl: 'https://www.youtube.com/watch?v=fixture',
    embedUrl: 'https://www.youtube-nocookie.com/embed/fixture',
    aspectRatio: 16 / 9,
  }),
)

const unavailable = decode(
  Blocks.UnavailableEmbed({
    kind: 'music',
    label: 'Record unavailable',
    href: null,
  }),
)

test('the mounted spotlight flow keeps mixed authored cards in order and only pairs adjacent records', async () => {
  const root = createRoot()
  await act(async () =>
    root.render(
      <SpotlightBlockFlow
        blocks={[
          Blocks.CardGroup({
            children: [
              record('A'),
              record('B'),
              media,
              unavailable,
              record('C'),
              record('D'),
              record('E'),
            ],
          }),
        ]}
        renderMusic={(block, compact) =>
          createElement('record', { title: block.music.title, compact })
        }
        renderBlock={(block) => createElement('fallback', { tag: block._tag })}
        renderRow={(children, count) => createElement('row', { count }, children)}
      />,
    ),
  )
  expect(
    root.container.children.map((node) => (Predicate.isString(node) ? node : node.type)),
  ).toEqual(['row', 'fallback', 'fallback', 'row', 'row'])
  expect(
    root.container.queryAll((node) => node.type === 'record').map((node) => node.props.title),
  ).toEqual(['A', 'B', 'C', 'D', 'E'])
  expect(
    root.container.queryAll((node) => node.type === 'fallback').map((node) => node.props.tag),
  ).toEqual(['ExternalMediaEmbed', 'UnavailableEmbed'])
  expect(
    root.container.queryAll((node) => node.type === 'row').map((node) => node.props.count),
  ).toEqual([2, 2, 1])
  await act(async () => root.unmount())
})

test('a media-only cards group is not blank and a standalone record remains full width', async () => {
  const root = createRoot()
  await act(async () =>
    root.render(
      <SpotlightBlockFlow
        blocks={[Blocks.CardGroup({ children: [media, media, unavailable] }), record('Full width')]}
        renderMusic={(block, compact) =>
          createElement('record', { title: block.music.title, compact })
        }
        renderBlock={(block) => createElement('fallback', { tag: block._tag })}
        renderRow={(children) => createElement('row', {}, children)}
      />,
    ),
  )
  expect(root.container.queryAll((node) => node.type === 'fallback')).toHaveLength(3)
  expect(root.container.queryAll((node) => node.type === 'record')[0]?.props.compact).toBe(false)
  expect(root.container.queryAll((node) => node.type === 'row')).toHaveLength(0)
  await act(async () => root.unmount())
})

test.each(['before', 'after'])(
  'a standalone record %s a card group stays full width',
  async (position) => {
    const group = Blocks.CardGroup({ children: [record('A'), record('B')] })
    const single = record('Standalone')
    const root = createRoot()
    await act(async () =>
      root.render(
        <SpotlightBlockFlow
          blocks={position === 'before' ? [single, group] : [group, single]}
          renderMusic={(block, compact) =>
            createElement('record', { title: block.music.title, compact })
          }
          renderBlock={(block) => createElement('fallback', { tag: block._tag })}
          renderRow={(children, count) => createElement('row', { count }, children)}
        />,
      ),
    )
    const records = root.container.queryAll((node) => node.type === 'record')
    expect(records.map((node) => node.props.title)).toEqual(
      position === 'before' ? ['Standalone', 'A', 'B'] : ['A', 'B', 'Standalone'],
    )
    expect(records.find((node) => node.props.title === 'Standalone')?.props.compact).toBe(false)
    expect(
      root.container.queryAll((node) => node.type === 'row').map((node) => node.props.count),
    ).toEqual([2])
    await act(async () => root.unmount())
  },
)

test('adjacent authored card groups never share a pairing run', async () => {
  const root = createRoot()
  await act(async () =>
    root.render(
      <SpotlightBlockFlow
        blocks={[
          Blocks.CardGroup({ children: [record('A')] }),
          Blocks.CardGroup({ children: [record('B')] }),
        ]}
        renderMusic={(block, compact) =>
          createElement('record', { title: block.music.title, compact })
        }
        renderBlock={(block) => createElement('fallback', { tag: block._tag })}
        renderRow={(children, count) => createElement('row', { count }, children)}
      />,
    ),
  )
  expect(
    root.container.queryAll((node) => node.type === 'row').map((node) => node.props.count),
  ).toEqual([1, 1])
  await act(async () => root.unmount())
})
