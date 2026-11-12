import { bandcampPlayerUrl } from '@gbfm/rich-content/media'
import type { RichContentDocument, SafeUrl } from '@gbfm/rich-content/schema'
import { Predicate } from 'effect'
import { inertHtml as h, type Html } from 'foldkit/html'
import { describe, expect, it } from 'vitest'

import { richContentView } from './render'

const safeUrl = (value: string): SafeUrl => {
  // SAFETY: Every URL passed by this closed test fixture uses an allowed HTTPS URL shape.
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  return value
}

// oxlint-disable anti-slop-effect/no-manual-tagged-construction -- This models a decoded document fixture at the renderer's typed boundary.
const document: RichContentDocument = {
  version: 1,
  blocks: [
    {
      _tag: 'Heading',
      level: 1,
      children: [{ _tag: 'Text', value: 'Title' }],
    },
    {
      _tag: 'Paragraph',
      children: [
        { _tag: 'Text', value: 'Text ' },
        { _tag: 'Emphasis', children: [{ _tag: 'Text', value: 'emphasis' }] },
        { _tag: 'Strong', children: [{ _tag: 'Text', value: 'strong' }] },
        { _tag: 'Delete', children: [{ _tag: 'Text', value: 'deleted' }] },
        { _tag: 'InlineCode', value: 'code' },
        {
          _tag: 'Link',
          href: safeUrl('https://example.com/read'),
          title: 'Read more',
          children: [{ _tag: 'Text', value: 'link' }],
        },
        {
          _tag: 'Image',
          src: safeUrl('https://example.com/image.jpg'),
          alt: 'A test image',
          title: 'Image title',
        },
        { _tag: 'Break' },
      ],
    },
    {
      _tag: 'List',
      ordered: true,
      start: 3,
      items: [
        {
          checked: true,
          children: [
            { _tag: 'Paragraph', children: [{ _tag: 'Text', value: 'Task' }] },
            {
              _tag: 'List',
              ordered: false,
              start: null,
              items: [
                {
                  checked: null,
                  children: [{ _tag: 'Paragraph', children: [{ _tag: 'Text', value: 'Nested' }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      _tag: 'Quote',
      children: [{ _tag: 'Paragraph', children: [{ _tag: 'Text', value: 'Quoted' }] }],
    },
    { _tag: 'Code', language: 'ts', value: 'const inert = true' },
    { _tag: 'ThematicBreak' },
    {
      _tag: 'Table',
      align: ['left', 'right'],
      rows: [
        [[{ _tag: 'Text', value: 'Name' }], [{ _tag: 'Text', value: 'Count' }]],
        [[{ _tag: 'Text', value: 'Records' }], [{ _tag: 'Text', value: '2' }]],
      ],
    },
    {
      _tag: 'MusicEmbed',
      genres: ['ambient'],
      blurb: 'A quiet record.',
      showTracks: true,
      music: {
        entityType: 'album',
        entityId: 'album-1',
        title: 'Stillness',
        artists: ['Artist'],
        description: 'An album.',
        imageUrl: safeUrl('https://example.com/cover.jpg'),
        canonicalUrl: safeUrl('https://example.com/album'),
        links: [{ platform: 'Bandcamp', url: safeUrl('https://example.com/listen') }],
        tracks: [
          {
            title: 'First',
            artists: ['Artist'],
            url: safeUrl('https://example.com/track'),
          },
        ],
      },
    },
    {
      _tag: 'ExternalMediaEmbed',
      provider: 'youtube',
      canonicalUrl: safeUrl('https://youtube.com/watch?v=video'),
      embedUrl: safeUrl('https://youtube.com/embed/video'),
      title: 'Test video',
      aspectRatio: 16 / 9,
    },
    { _tag: 'Tracklist', tracks: [{ title: 'Artist — Song' }] },
    {
      _tag: 'CardGroup',
      children: [
        {
          _tag: 'UnavailableEmbed',
          kind: 'music',
          label: 'Music unavailable',
          href: safeUrl('https://example.com/fallback'),
        },
      ],
    },
    {
      _tag: 'UnavailableEmbed',
      kind: 'media',
      label: 'Media unavailable',
      href: safeUrl('https://artist.bandcamp.com/track/night-vigil'),
    },
    {
      _tag: 'ExternalMediaEmbed',
      provider: 'bandcamp',
      canonicalUrl: safeUrl('https://artist.bandcamp.com/track/night-vigil'),
      embedUrl: safeUrl(bandcampPlayerUrl('track', '42')),
      title: 'Night Vigil',
      aspectRatio: 16 / 5,
    },
    {
      _tag: 'Unsupported',
      source: '<script>not executable</script>',
      reason: 'raw-html',
    },
  ],
}
// oxlint-enable anti-slop-effect/no-manual-tagged-construction

const render = () => richContentView(document, h, { className: 'article-body' })

type VNode = NonNullable<Html>

const childNodes = (node: VNode): ReadonlyArray<VNode> =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Foldkit's public VNode child contract is the explicit union VNode | string.
  (node.children ?? []).filter((child): child is VNode => typeof child !== 'string')

const descendants = (node: VNode): ReadonlyArray<VNode> => [
  node,
  ...childNodes(node).flatMap(descendants),
]

const hasClass = (node: VNode, className: string): boolean => node.data?.class?.[className] === true

const findAll = (node: VNode, selector: string): ReadonlyArray<VNode> =>
  descendants(node).filter((candidate) =>
    selector.startsWith('.') ? hasClass(candidate, selector.slice(1)) : candidate.sel === selector,
  )

const first = (nodes: ReadonlyArray<VNode>): VNode => {
  const node = nodes[0]

  expect(node).toBeDefined()

  if (node === undefined) throw new Error('Expected a matching rendered node')

  return node
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- Foldkit exposes heterogeneous DOM property values; assertions compare them at this test boundary.
const attribute = (node: VNode, name: string): unknown =>
  node.data?.props?.[name] ?? node.data?.attrs?.[name]

const textContent = (node: VNode): string =>
  node.text ??
  (node.children ?? [])
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Foldkit's public VNode child contract is the explicit union VNode | string.
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')

describe('richContentView', () => {
  it('renders every rich-content variant as semantic inert HTML', () => {
    const rendered = render()
    const view = first(rendered === null ? [] : [rendered])

    expect(textContent(view)).toContain('Title')
    expect(findAll(view, 'h1')).toHaveLength(1)
    expect(findAll(view, 'em')).toHaveLength(1)
    expect(findAll(view, 'strong')).toHaveLength(1)
    expect(findAll(view, 'del')).toHaveLength(1)
    expect(findAll(view, 'blockquote')).toHaveLength(1)
    expect(findAll(view, 'hr')).toHaveLength(1)
    expect(findAll(view, 'th')).toHaveLength(2)
    expect(findAll(view, 'td')).toHaveLength(2)
    expect(findAll(view, '.rich-content-music-card')).toHaveLength(1)
    expect(findAll(view, '.rich-content-card-group')).toHaveLength(1)
    expect(findAll(view, '.rich-content-tracklist')).toHaveLength(1)
    expect(textContent(view)).toContain('<script>not executable</script>')
  })

  it('preserves heading, list, image, and table accessibility semantics', () => {
    const rendered = render()
    const view = first(rendered === null ? [] : [rendered])
    const list = first(findAll(view, 'ol').filter((node) => attribute(node, 'start') === 3))

    const image = first(
      findAll(view, 'img').filter((node) => attribute(node, 'alt') === 'A test image'),
    )

    const heading = first(findAll(view, 'h1'))

    expect(textContent(heading)).toBe('Title')
    expect(attribute(list, 'start')).toBe(3)
    expect(attribute(image, 'loading')).toBe('lazy')
    expect(findAll(view, 'th').every((node) => attribute(node, 'scope') === 'col')).toBe(true)
    expect(findAll(view, 'input')).toHaveLength(1)
  })

  it('fixes outbound-link and iframe security attributes', () => {
    const rendered = render()
    const view = first(rendered === null ? [] : [rendered])

    const link = first(
      findAll(view, 'a').filter((node) => attribute(node, 'href') === 'https://example.com/read'),
    )

    const iframe = first(findAll(view, 'iframe'))

    expect(attribute(link, 'rel')).toBe('noopener noreferrer')
    expect(attribute(link, 'target')).toBe('_blank')
    expect(attribute(iframe, 'src')).toBe('https://youtube.com/embed/video')
    expect(attribute(iframe, 'title')).toBe('YouTube player: Test video')
    expect(attribute(iframe, 'loading')).toBe('lazy')
    expect(attribute(iframe, 'referrerpolicy')).toBe('strict-origin-when-cross-origin')
    expect(attribute(iframe, 'sandbox')).toBe(
      'allow-scripts allow-same-origin allow-presentation allow-popups',
    )
    expect(attribute(iframe, 'allow')).toBe(
      'autoplay; encrypted-media; fullscreen; picture-in-picture',
    )
  })

  it('exposes music titles and artists without requiring a prose caption', () => {
    const rendered = render()
    const view = first(rendered === null ? [] : [rendered])
    const card = first(findAll(view, '.rich-content-music-card'))
    const heading = first(findAll(card, 'h3'))
    const artist = first(findAll(card, '.rich-content-music-artists'))
    const titleLink = first(findAll(heading, 'a'))
    const providerLink = first(findAll(first(findAll(card, '.rich-content-music-links')), 'a'))

    expect(attribute(card, 'aria-label')).toBe('Album: Stillness by Artist')
    expect(textContent(heading)).toBe('Stillness')
    expect(textContent(artist)).toBe('Artist')
    expect(attribute(artist, 'aria-hidden')).toBeUndefined()
    expect(attribute(first(findAll(card, 'img')), 'alt')).toBe('Artwork for Stillness by Artist')
    expect(attribute(titleLink, 'aria-label')).toBe('Stillness by Artist (opens in a new tab)')
    expect(attribute(providerLink, 'aria-label')).toBe(
      'Listen to Stillness by Artist on Bandcamp (opens in a new tab)',
    )
    expect(attribute(providerLink, 'target')).toBe('_blank')
    expect(textContent(providerLink)).toBe('Bandcamp')
    expect(attribute(first(findAll(card, 'img')), 'loading')).toBe('lazy')
    expect(attribute(first(findAll(card, 'img')), 'decoding')).toBe('async')
  })

  it('distinguishes repeated titles by artist and labels internal links without a new-tab notice', () => {
    const original = document.blocks.find((block) => Predicate.isTagged(block, 'MusicEmbed'))

    if (original === undefined) throw new Error('Expected the music fixture')

    const rendered = richContentView(
      {
        version: 1,
        blocks: [
          original,
          {
            ...original,
            music: {
              ...original.music,
              artists: ['Another Artist'],
              canonicalUrl: '/collections/stillness',
              links: [{ platform: 'gbfm', url: '/collections/stillness' }],
            },
          },
          {
            ...original,
            music: { ...original.music, artists: [] },
          },
        ],
      },
      h,
    )

    const view = first(rendered === null ? [] : [rendered])
    const cards = findAll(view, '.rich-content-music-card')

    expect(cards.map((card) => attribute(card, 'aria-label'))).toEqual([
      'Album: Stillness by Artist',
      'Album: Stillness by Another Artist',
      'Album: Stillness',
    ])

    const internal = first(
      findAll(view, 'a').filter((a) => attribute(a, 'href') === '/collections/stillness'),
    )

    expect(attribute(internal, 'aria-label')).toBe('Stillness by Another Artist')
    expect(attribute(internal, 'target')).toBeUndefined()
  })

  it('renders unavailable music as a notice and unavailable media as a provider link card', () => {
    const rendered = render()
    const view = first(rendered === null ? [] : [rendered])
    const unavailable = findAll(view, '.rich-content-unavailable')
    const card = first(findAll(view, '.rich-content-link-card'))
    const listen = first(findAll(card, 'a'))

    expect(unavailable).toHaveLength(1)
    expect(textContent(first(unavailable))).toContain('Music unavailable')
    expect(findAll(first(unavailable), 'a')).toHaveLength(1)
    expect(textContent(card)).toContain('Bandcamp')
    expect(textContent(card)).toContain('artist.bandcamp.com')
    expect(textContent(listen)).toBe('Listen on Bandcamp')
    expect(attribute(listen, 'href')).toBe('https://artist.bandcamp.com/track/night-vigil')
  })

  it('keeps every playlist track and verified provider link when a long list is collapsed', () => {
    const tracks = Array.from({ length: 12 }, (_, index) => ({
      title: `Track ${index + 1}`,
      artists: [],
      url: index === 11 ? safeUrl('https://open.spotify.com/track/last') : null,
    }))

    const rendered = richContentView(
      {
        version: 1,
        blocks: [
          {
            // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- This models a decoded document fixture at the renderer's typed boundary.
            _tag: 'MusicEmbed',
            genres: [],
            blurb: null,
            showTracks: true,
            music: {
              entityType: 'playlist',
              entityId: 'playlist-1',
              title: 'Long Playlist',
              artists: [],
              description: null,
              imageUrl: null,
              canonicalUrl: safeUrl('https://open.spotify.com/playlist/long'),
              links: [
                { platform: 'spotify', url: safeUrl('https://open.spotify.com/playlist/long') },
                { platform: 'apple_music', url: safeUrl('https://music.apple.com/playlist/long') },
              ],
              tracks,
            },
          },
        ],
      },
      h,
    )

    const view = first(rendered === null ? [] : [rendered])
    const [visible, hidden] = findAll(view, 'ol')
    const disclosure = first(findAll(view, 'details'))
    const links = findAll(first(findAll(view, '.rich-content-music-links')), 'a')

    expect(findAll(view, 'img')).toHaveLength(0)
    expect(findAll(visible ?? first([]), 'li').map(textContent)).toEqual(
      tracks.slice(0, 10).map((track, index) => `${index + 1}${track.title}`),
    )
    expect(attribute(hidden ?? first([]), 'start')).toBe(11)
    expect(findAll(disclosure, 'li').map(textContent)).toEqual(['11Track 11', '12Track 12'])
    expect(textContent(first(findAll(disclosure, '.rich-content-disclosure-closed')))).toBe(
      'Show all 12 tracks',
    )
    expect(attribute(first(findAll(disclosure, 'a')), 'href')).toBe(
      'https://open.spotify.com/track/last',
    )
    expect(links.map((link) => [textContent(link), attribute(link, 'href')])).toEqual([
      ['Spotify', 'https://open.spotify.com/playlist/long'],
      ['Apple Music', 'https://music.apple.com/playlist/long'],
    ])
  })

  it('gives Bandcamp a fixed-height player per theme and links the release page', () => {
    const rendered = render()
    const view = first(rendered === null ? [] : [rendered])

    const figure = first(
      findAll(view, 'figure').filter((node) => textContent(node).includes('Bandcamp')),
    )

    const [light, dark] = findAll(figure, 'iframe')

    expect(attribute(light ?? first([]), 'src')).toContain('/track=42/size=large/bgcol=ffffff/')
    expect(attribute(dark ?? first([]), 'src')).toContain('/track=42/size=large/bgcol=333333/')
    expect(hasClass(dark ?? first([]), 'rich-content-media-dark')).toBe(true)
    expect(attribute(first(findAll(figure, 'a')), 'href')).toBe(
      'https://artist.bandcamp.com/track/night-vigil',
    )
  })
})
