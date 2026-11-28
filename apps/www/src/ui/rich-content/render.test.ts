import { BANDCAMP_PLAYER_HEIGHT, bandcampPlayerUrl } from '@gbfm/rich-content/media'
import {
  RichContentDocument,
  type RichContentBlock,
  type RichContentInline,
  type SafeUrl,
} from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { Data, Predicate, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { renderRichContent } from '../ssr-fixture.test-support'
import { attribute, element, findAll, first, hasClass, textContent } from '../ssr-html.test-support'

const Block = Data.taggedEnum<RichContentBlock>()

const Inline = Data.taggedEnum<RichContentInline>()

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
    { _tag: 'Tracklist', tracks: [{ title: 'Artist - Song' }] },
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

const render = () => renderRichContent(document, { className: 'article-body' })

const renderMicroCard = async (source: RichContentDocument) =>
  first(findAll(element(await renderRichContent(source)), '.rich-content-micro'))

describe('richContentView', () => {
  it('keeps re:fikks and re:prises readable in headings, formatting, links, quotes and lists', async () => {
    const source = [
      '## Re:fikks',
      '**re:fikks** and [re:prises](/profile/kimetsu)',
      '> a [kimetsu.] re:fikks',
      '- Henrik Schwarz: KEEPING IT UP / re:prises',
    ].join('\n\n')

    const document = Schema.decodeUnknownSync(RichContentDocument)(
      parseRichContent(source).document,
    )

    const rendered = await renderRichContent(document)
    const view = element(rendered)

    expect(textContent(view).match(/re:(?:fikks|prises)/gi)).toEqual([
      'Re:fikks',
      're:fikks',
      're:prises',
      're:fikks',
      're:prises',
    ])
    expect(attribute(first(findAll(view, 'a')), 'href')).toBe('/profile/kimetsu')
    expect(textContent(first(findAll(view, 'strong')))).toBe('re:fikks')
  })

  /* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- This decoded fixture exercises recursive rich-content wire values. */
  it('renders legacy micro metadata with a profile link, date permalink and inline prose links', async () => {
    const source = Schema.decodeUnknownSync(RichContentDocument)({
      version: 1,
      blocks: [
        {
          _tag: 'Quote',
          micro: {
            postId: 'b19847c2-fe58-4fd8-878a-b2faf138dfd7',
            slug: 'canon',
            title: null,
            createdAt: '2026-11-24T08:25:34.463Z',
            authors: [{ name: 'Guide Fari', username: 'guidefari' }],
          },
          children: [
            {
              _tag: 'Paragraph',
              children: [
                { _tag: 'Text', value: 'music i know will stay with me forever.' },
                {
                  _tag: 'Link',
                  href: '/tweet/canon',
                  title: null,
                  children: [{ _tag: 'Text', value: 'View original note on GBFM' }],
                },
              ],
            },
          ],
        },
      ],
    })

    const card = await renderMicroCard(source)
    expect(attribute(card, 'aria-label')).toBe('Embedded note by Guide Fari')
    expect(hasClass(card, 'not-prose')).toBe(true)
    expect(textContent(card)).toContain('music i know will stay with me forever.')
    expect(findAll(card, 'img')).toHaveLength(0)
    expect(findAll(card, 'footer')).toHaveLength(0)
    expect(textContent(card)).not.toMatch(/GBFM note|View note/)
    const profile = first(findAll(first(findAll(card, '.rich-content-micro-author')), 'a'))
    expect(textContent(profile)).toBe('Guide Fari')
    expect(attribute(profile, 'href')).toBe('/profile/guidefari')
    const permalink = first(findAll(card, '.rich-content-micro-date'))
    expect(permalink.tag).toBe('a')
    expect(attribute(permalink, 'href')).toBe('/tweet/canon')
    expect(attribute(permalink, 'aria-label')).toBe('View original note on GBFM')
    const date = first(findAll(permalink, 'time'))
    expect(textContent(date)).toBe('Nov 24, 2026')
    expect(attribute(date, 'dateTime')).toBe('2026-11-24T08:25:34.463Z')
    const body = first(findAll(card, '.rich-content-micro-body'))
    expect(findAll(body, 'a').map((node) => attribute(node, 'href'))).toEqual(['/tweet/canon'])
    expect(findAll(card, 'iframe')).toHaveLength(0)
  })

  it('renders the author photo and omits only the generated terminal permalink', async () => {
    const source = Schema.decodeUnknownSync(RichContentDocument)({
      version: 1,
      blocks: [
        {
          _tag: 'Quote',
          micro: {
            postId: 'b19847c2-fe58-4fd8-878a-b2faf138dfd7',
            slug: 'canon',
            title: null,
            createdAt: '2026-11-24T08:25:34.463Z',
            authors: [
              {
                name: 'Guide Fari',
                username: 'guidefari',
                image: 'https://images.example.com/guide.jpg',
              },
            ],
          },
          children: [
            {
              _tag: 'Paragraph',
              children: [
                { _tag: 'Text', value: 'music i know will stay with me forever. ' },
                {
                  _tag: 'Link',
                  href: 'https://example.com/canon',
                  title: null,
                  children: [{ _tag: 'Text', value: 'more' }],
                },
              ],
            },
            {
              _tag: 'Paragraph',
              children: [
                {
                  _tag: 'Link',
                  href: '/tweet/canon',
                  title: null,
                  children: [{ _tag: 'Text', value: 'View original note on GBFM' }],
                },
              ],
            },
          ],
        },
      ],
    })

    const card = await renderMicroCard(source)
    const avatar = first(findAll(card, 'img'))
    expect(attribute(avatar, 'src')).toBe('https://images.example.com/guide.jpg')
    expect(attribute(avatar, 'alt')).toBe("Guide Fari's avatar")
    expect(attribute(avatar, 'sizes')).toBe('36px')
    expect(String(attribute(avatar, 'width'))).toBe('36')
    expect(String(attribute(avatar, 'height'))).toBe('36')
    expect(attribute(avatar, 'loading')).toBe('lazy')
    expect(hasClass(avatar, 'artwork')).toBe(true)
    const body = first(findAll(card, '.rich-content-micro-body'))
    expect(textContent(body)).toBe('music i know will stay with me forever. more')
    expect(findAll(body, 'a').map((node) => attribute(node, 'href'))).toEqual([
      'https://example.com/canon',
    ])

    const permalinks = findAll(card, 'a').filter(
      (node) => attribute(node, 'href') === '/tweet/canon',
    )

    expect(permalinks).toHaveLength(1)
    expect(attribute(first(permalinks), 'aria-label')).toBe('View original note on GBFM')
    expect(findAll(card, 'footer')).toHaveLength(0)
    expect(source.blocks[0]).toMatchObject({
      children: [{}, { children: [{ _tag: 'Link', href: '/tweet/canon' }] }],
    })
  })

  it('keeps every co-author attributed and shows only the first photo', async () => {
    const source = Schema.decodeUnknownSync(RichContentDocument)({
      version: 1,
      blocks: [
        {
          _tag: 'Quote',
          micro: {
            postId: 'b19847c2-fe58-4fd8-878a-b2faf138dfd7',
            slug: 'canon',
            title: null,
            createdAt: '2026-11-24T08:25:34.463Z',
            authors: [
              { name: 'Guide Fari', username: 'guidefari', image: '/first.png' },
              { name: 'Second Writer', username: null, image: '/second.png' },
              { name: 'Third Writer', username: 'third', image: null },
            ],
          },
          children: [{ _tag: 'Paragraph', children: [{ _tag: 'Text', value: 'shared note' }] }],
        },
      ],
    })

    const card = await renderMicroCard(source)
    expect(attribute(card, 'aria-label')).toBe(
      'Embedded note by Guide Fari, Second Writer, Third Writer',
    )
    const byline = first(findAll(card, '.rich-content-micro-author'))
    expect(textContent(byline)).toBe('Guide Fari, Second Writer, Third Writer')
    expect(findAll(byline, 'a').map((node) => attribute(node, 'href'))).toEqual([
      '/profile/guidefari',
      '/profile/third',
    ])
    const images = findAll(card, 'img')
    expect(images).toHaveLength(1)
    expect(attribute(first(images), 'alt')).toBe("Guide Fari's avatar")
  })

  it('omits the photo for a null image and rejects unsafe image URLs at the wire boundary', async () => {
    const note = (image: string | null) => ({
      version: 1,
      blocks: [
        {
          _tag: 'Quote',
          micro: {
            postId: 'b19847c2-fe58-4fd8-878a-b2faf138dfd7',
            slug: 'canon',
            title: null,
            createdAt: '2026-11-24T08:25:34.463Z',
            authors: [{ name: 'Guide Fari', username: 'guidefari', image }],
          },
          children: [{ _tag: 'Paragraph', children: [{ _tag: 'Text', value: 'body' }] }],
        },
      ],
    })

    const card = await renderMicroCard(Schema.decodeUnknownSync(RichContentDocument)(note(null)))
    expect(findAll(card, 'img')).toHaveLength(0)
    expect(findAll(card, '.rich-content-micro-avatar')).toHaveLength(0)
    expect(textContent(card)).toContain('body')
    expect(() =>
      Schema.decodeUnknownSync(RichContentDocument)(note('javascript:alert(1)')),
    ).toThrow()
  })
  /* oxlint-enable anti-slop-effect/no-manual-tagged-construction */

  it('renders every rich-content variant as semantic inert HTML', async () => {
    const rendered = await render()
    const view = element(rendered)

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
    expect(rendered).toContain('&lt;script&gt;not executable&lt;/script&gt;')
    expect(rendered).not.toMatch(/<script(?:\s|>)/i)
    expect(hasClass(first(findAll(view, '.rich-content')), 'article-body')).toBe(true)
  })

  it('preserves heading, list, image, and table accessibility semantics', async () => {
    const rendered = await render()
    const view = element(rendered)
    const list = first(findAll(view, 'ol').filter((node) => attribute(node, 'start') === '3'))

    const image = first(
      findAll(view, 'img').filter((node) => attribute(node, 'alt') === 'A test image'),
    )

    const heading = first(findAll(view, 'h1'))

    expect(textContent(heading)).toBe('Title')
    expect(attribute(list, 'start')).toBe('3')
    expect(attribute(image, 'loading')).toBe('lazy')
    expect(attribute(image, 'title')).toBe('Image title')
    expect(attribute(image, 'decoding')).toBe('async')
    expect(findAll(view, 'th').every((node) => attribute(node, 'scope') === 'col')).toBe(true)
    expect(findAll(view, 'input')).toHaveLength(1)
    expect(first(findAll(view, 'input')).attributes).toMatchObject({
      type: 'checkbox',
      checked: '',
      disabled: '',
      'aria-label': 'Completed task',
    })
    expect(attribute(first(findAll(view, 'th')), 'style')).toContain('text-align:left')
    expect(attribute(first(findAll(view, 'td')), 'style')).toContain('text-align:left')
    expect(attribute(findAll(view, 'th')[1] ?? first([]), 'style')).toContain('text-align:right')
    expect(attribute(findAll(view, 'td')[1] ?? first([]), 'style')).toContain('text-align:right')
  })

  it('fixes outbound-link and iframe security attributes', async () => {
    const rendered = await render()
    const view = element(rendered)

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
    expect(attribute(first(findAll(view, '.rich-content-media-frame')), 'style')).toBe(
      `aspect-ratio:${16 / 9}`,
    )
  })

  it('exposes music titles and artists without requiring a prose caption', async () => {
    const rendered = await render()
    const view = element(rendered)
    const card = first(findAll(view, '.rich-content-music-card'))
    const heading = first(findAll(card, 'h3'))
    const artist = first(findAll(card, '.rich-content-music-artists'))
    const titleLink = first(findAll(heading, 'a'))
    const providerLink = first(findAll(first(findAll(card, '.rich-content-music-links')), 'a'))

    expect(attribute(card, 'aria-label')).toBe('Album: Stillness by Artist')
    expect(textContent(heading)).toBe('Stillness')
    expect(findAll(card, '.rich-content-music-title')).toHaveLength(1)
    expect(textContent(card).match(/Stillness/g)).toHaveLength(1)
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

  it('gives each streaming platform a distinct decorative icon without losing link labels or destinations', async () => {
    const platforms = [
      { platform: 'spotify', label: 'Spotify', color: '#1DB954' },
      { platform: 'apple_music', label: 'Apple Music', color: '#FA243C' },
      { platform: 'bandcamp', label: 'Bandcamp', color: '#408294' },
      { platform: 'soundcloud', label: 'SoundCloud', color: '#FF5500' },
      { platform: 'tidal', label: 'Tidal', color: 'currentColor' },
      { platform: 'deezer', label: 'Deezer', color: '#A238FF' },
      { platform: 'amazon_music', label: 'Amazon Music', color: 'currentColor' },
      { platform: 'youtube', label: 'YouTube', color: '#FF0000' },
      { platform: 'youtube_music', label: 'YT Music', color: '#FF0000' },
    ]

    const source = Schema.decodeUnknownSync(RichContentDocument)({
      ...document,
      blocks: document.blocks.map((block) =>
        Predicate.isTagged(block, 'MusicEmbed')
          ? {
              ...block,
              music: {
                ...block.music,
                links: platforms.map(({ platform }) => ({
                  platform,
                  url: `https://example.com/${platform}`,
                })),
              },
            }
          : block,
      ),
    })

    const rendered = await renderRichContent(source)
    const view = element(rendered)
    const card = first(findAll(view, '.rich-content-music-card'))
    const links = findAll(first(findAll(card, '.rich-content-music-links')), 'a')

    expect(links.map(textContent)).toEqual(platforms.map(({ label }) => label))
    expect(links.map((link) => attribute(link, 'href'))).toEqual(
      platforms.map(({ platform }) => `https://example.com/${platform}`),
    )
    expect(links.map((link) => attribute(first(findAll(link, 'svg')), 'fill'))).toEqual(
      platforms.map(({ color }) => color),
    )

    for (const link of links) {
      const icons = findAll(link, 'svg')
      expect(icons).toHaveLength(1)
      expect(attribute(first(icons), 'aria-hidden')).toBe('true')
      expect(attribute(link, 'target')).toBe('_blank')
      expect(attribute(link, 'rel')).toBe('noopener noreferrer')
    }

    expect(new Set(links.map((link) => attribute(first(findAll(link, 'path')), 'd'))).size).toBe(
      platforms.length,
    )
  })

  it('marks YouTube links with decorative icons without changing their names or destinations', async () => {
    const urls = [
      'https://www.youtube.com/watch?v=example',
      'https://youtu.be/example',
      'https://m.youtube.com/watch?v=example',
      'https://youtube.com.evil.example/watch?v=example',
      '/youtube',
      'https://example.com/?next=https://youtube.com',
    ]

    const source = urls.map((url, index) => `[Watch ${index}](${url})`).join('\n\n')
    const parsed = Schema.decodeUnknownSync(RichContentDocument)(parseRichContent(source).document)
    const rendered = await renderRichContent(parsed)
    const view = element(rendered)
    const links = findAll(view, 'a')

    expect(links.map((link) => attribute(link, 'href'))).toEqual(urls)
    expect(links.map(textContent)).toEqual(urls.map((_, index) => `Watch ${index}`))
    expect(links.map((link) => findAll(link, '.rich-content-youtube-icon').length)).toEqual([
      1, 1, 1, 0, 0, 0,
    ])

    for (const icon of findAll(view, '.rich-content-youtube-icon')) {
      expect(attribute(icon, 'aria-hidden')).toBe('true')
    }
  })

  it('distinguishes repeated titles by artist and labels internal links without a new-tab notice', async () => {
    const original = document.blocks.find((block) => Predicate.isTagged(block, 'MusicEmbed'))

    if (original === undefined) throw new Error('Expected the music fixture')

    const rendered = await renderRichContent({
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
    })

    const view = element(rendered)
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
    expect(attribute(internal, 'rel')).toBeUndefined()
  })

  it('renders unavailable music as a notice and unavailable media as a provider link card', async () => {
    const rendered = await render()
    const view = element(rendered)
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

  it('keeps every playlist track and verified provider link when a long list is collapsed', async () => {
    const tracks = Array.from({ length: 12 }, (_, index) => ({
      title: `Track ${index + 1}`,
      artists: [],
      url: index === 11 ? safeUrl('https://open.spotify.com/track/last') : null,
    }))

    const rendered = await renderRichContent({
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
    })

    const view = element(rendered)
    const [visible, hidden] = findAll(view, 'ol')
    const disclosure = first(findAll(view, 'details'))
    const links = findAll(first(findAll(view, '.rich-content-music-links')), 'a')

    expect(findAll(view, 'img')).toHaveLength(0)
    expect(attribute(disclosure, 'open')).toBeUndefined()
    expect(attribute(visible ?? first([]), 'aria-label')).toBe('Long Playlist tracks')
    expect(attribute(hidden ?? first([]), 'aria-label')).toBe('More Long Playlist tracks')
    expect(findAll(visible ?? first([]), 'li').map(textContent)).toEqual(
      tracks.slice(0, 10).map((track, index) => `${index + 1}${track.title}`),
    )
    expect(attribute(hidden ?? first([]), 'start')).toBe('11')
    expect(findAll(disclosure, 'li').map(textContent)).toEqual(['11Track 11', '12Track 12'])
    expect(textContent(first(findAll(disclosure, '.rich-content-disclosure-closed')))).toBe(
      'Show all 12 tracks',
    )
    expect(textContent(first(findAll(disclosure, '.rich-content-disclosure-open')))).toBe(
      'Hide tracks 11–12',
    )
    expect(attribute(first(findAll(disclosure, 'a')), 'href')).toBe(
      'https://open.spotify.com/track/last',
    )
    expect(links.map((link) => [textContent(link), attribute(link, 'href')])).toEqual([
      ['Spotify', 'https://open.spotify.com/playlist/long'],
      ['Apple Music', 'https://music.apple.com/playlist/long'],
    ])
  })

  it('gives Bandcamp a fixed-height player per theme and links the release page', async () => {
    const rendered = await render()
    const view = element(rendered)

    const figure = first(
      findAll(view, 'figure').filter((node) => textContent(node).includes('Bandcamp')),
    )

    const [light, dark] = findAll(figure, 'iframe')

    expect(attribute(light ?? first([]), 'src')).toContain('/track=42/size=large/bgcol=ffffff/')
    expect(attribute(dark ?? first([]), 'src')).toContain('/track=42/size=large/bgcol=333333/')
    expect(hasClass(light ?? first([]), 'rich-content-media-light')).toBe(true)
    expect(hasClass(dark ?? first([]), 'rich-content-media-dark')).toBe(true)
    expect(attribute(first(findAll(figure, '.rich-content-media-frame')), 'style')).toBe(
      `height:${BANDCAMP_PLAYER_HEIGHT}px`,
    )
    expect(BANDCAMP_PLAYER_HEIGHT).toBe(120)

    for (const player of findAll(figure, 'iframe')) {
      expect(attribute(player, 'height')).toBe('100%')
      expect(attribute(player, 'width')).toBe('100%')
      expect(attribute(player, 'loading')).toBe('lazy')
    }

    expect(attribute(first(findAll(figure, 'a')), 'href')).toBe(
      'https://artist.bandcamp.com/track/night-vigil',
    )
  })
})

describe('native rich-content SSR security and semantic boundaries', () => {
  it('keeps the generated micro headline singular and encodes author and permalink path segments', async () => {
    const source = Schema.decodeUnknownSync(RichContentDocument)({
      version: 1,
      blocks: [
        Block.Quote({
          micro: {
            postId: 'micro-fixture',
            slug: 'a/b?x',
            title: 'One headline',
            createdAt: '2026-11-24T08:25:34.463Z',
            authors: [{ name: 'Writer', username: 'name/with?query', image: null }],
          },
          children: [Block.Paragraph({ children: [Inline.Text({ value: 'Body fixture' })] })],
        }),
      ],
    })

    const card = await renderMicroCard(source)
    expect(findAll(card, 'h3').map(textContent)).toEqual(['One headline'])
    expect(textContent(card).match(/One headline/g)).toHaveLength(1)
    expect(attribute(first(findAll(card, '.rich-content-micro-date')), 'href')).toBe(
      '/tweet/a%2Fb%3Fx',
    )
    expect(
      attribute(first(findAll(first(findAll(card, '.rich-content-micro-author')), 'a')), 'href'),
    ).toBe('/profile/name%2Fwith%3Fquery')
  })

  it('rejects executable URLs in every music artwork, source, provider, and track field', () => {
    const original = document.blocks.find((block) => Predicate.isTagged(block, 'MusicEmbed'))

    if (!original) throw new Error('Expected the decoded music fixture')
    const unsafe = 'javascript:alert(1)'

    for (const music of [
      { ...original.music, imageUrl: unsafe },
      { ...original.music, canonicalUrl: unsafe },
      { ...original.music, links: [{ platform: 'other', url: unsafe }] },
      { ...original.music, tracks: [{ title: 'Track', artists: [], url: unsafe }] },
    ])
      expect(() =>
        Schema.decodeUnknownSync(RichContentDocument)({
          version: 1,
          blocks: [{ ...original, music }],
        }),
      ).toThrow()
  })

  it('preserves every heading level and unchecked task semantics', async () => {
    const source = Schema.decodeUnknownSync(RichContentDocument)({
      version: 1,
      blocks: [
        ...[1, 2, 3, 4, 5, 6].map((level) => ({
          ...Block.Heading({ level: 1, children: [Inline.Text({ value: `Heading ${level}` })] }),
          level,
        })),
        Block.List({
          ordered: true,
          start: null,
          items: [
            {
              checked: false,
              children: [Block.Paragraph({ children: [Inline.Text({ value: 'Incomplete' })] })],
            },
          ],
        }),
      ],
    })

    const view = element(await renderRichContent(source))

    for (const level of [1, 2, 3, 4, 5, 6])
      expect(findAll(view, `h${level}`).map(textContent)).toEqual([`Heading ${level}`])
    const checkbox = first(findAll(view, 'input'))
    expect(attribute(checkbox, 'checked')).toBeUndefined()
    expect(attribute(checkbox, 'disabled')).toBe('')
    expect(attribute(checkbox, 'aria-label')).toBe('Incomplete task')
    expect(attribute(first(findAll(view, 'ol')), 'start')).toBeUndefined()
  })

  it('keeps inline text and quoted attributes escaped rather than creating active HTML', async () => {
    const unsafe = '<script>alert("fixture")</script>'
    const quoted = '" autofocus onfocus="alert(1)'

    const source = Schema.decodeUnknownSync(RichContentDocument)({
      version: 1,
      blocks: [
        Block.Paragraph({
          children: [
            Inline.Text({ value: unsafe }),
            Inline.Link({
              href: '/safe',
              title: quoted,
              children: [Inline.Text({ value: 'Safe label' })],
            }),
            Inline.Image({ src: '/safe.webp', alt: quoted, title: quoted }),
          ],
        }),
      ],
    })

    const html = await renderRichContent(source)
    const view = element(html)
    const link = first(findAll(view, 'a'))
    const image = first(findAll(view, 'img'))
    expect(textContent(view)).toContain(unsafe)
    expect(findAll(view, 'script')).toHaveLength(0)
    expect(attribute(link, 'title')).toBe(quoted)
    expect(attribute(image, 'alt')).toBe(quoted)
    expect(attribute(image, 'title')).toBe(quoted)

    for (const node of [link, image]) {
      expect(attribute(node, 'autofocus')).toBeUndefined()
      expect(attribute(node, 'onfocus')).toBeUndefined()
    }
  })

  it.each([
    'javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/image.jpg',
    'https://user:password@example.com/image.jpg',
  ])('rejects unsafe rich-content URL %s before SSR', (url) => {
    const image = Block.Paragraph({
      children: [Inline.Image({ src: url, alt: 'Fixture', title: null })],
    })

    const link = Block.Paragraph({
      children: [
        Inline.Link({ href: url, title: null, children: [Inline.Text({ value: 'Link' })] }),
      ],
    })

    const player = Block.ExternalMediaEmbed({
      provider: 'youtube',
      canonicalUrl: 'https://youtube.com/watch?v=fixture',
      embedUrl: url,
      title: 'Fixture',
      aspectRatio: 16 / 9,
    })

    for (const block of [image, link, player])
      expect(() =>
        Schema.decodeUnknownSync(RichContentDocument)({
          version: 1,
          blocks: [block],
        }),
      ).toThrow()
  })

  it('does not add a new-tab notice to internal links and protects mail links', async () => {
    const source = Schema.decodeUnknownSync(RichContentDocument)(
      parseRichContent('[Local](/about) and [Email](mailto:hello@example.com)').document,
    )

    const links = findAll(element(await renderRichContent(source)), 'a')
    expect(attribute(first(links), 'target')).toBeUndefined()
    expect(attribute(first(links), 'rel')).toBeUndefined()
    const email = links[1] ?? first([])
    expect(attribute(email, 'href')).toBe('mailto:hello@example.com')
    expect(attribute(email, 'target')).toBe('_blank')
    expect(attribute(email, 'rel')).toBe('noopener noreferrer')
  })

  it('renders unavailable embeds without inventing source links or players', async () => {
    const source = Schema.decodeUnknownSync(RichContentDocument)({
      version: 1,
      blocks: [
        Block.UnavailableEmbed({ kind: 'media', label: 'Media unavailable', href: null }),
        Block.UnavailableEmbed({ kind: 'music', label: 'Music unavailable', href: null }),
      ],
    })

    const view = element(await renderRichContent(source))
    expect(findAll(view, 'a')).toHaveLength(0)
    expect(findAll(view, 'iframe')).toHaveLength(0)
    expect(textContent(view)).toContain('Embedded media')
    expect(textContent(view)).toContain('Player unavailable right now')
    expect(attribute(first(findAll(view, '.rich-content-unavailable')), 'role')).toBe('status')
  })

  it.each([
    {
      provider: 'soundcloud',
      embedUrl: 'https://w.soundcloud.com/player/?url=fixture',
      height: 166,
    },
    { provider: 'spotify', embedUrl: 'https://open.spotify.com/embed/track/fixture', height: 152 },
    {
      provider: 'spotify',
      embedUrl: 'https://open.spotify.com/embed/episode/fixture',
      height: 152,
    },
    { provider: 'spotify', embedUrl: 'https://open.spotify.com/embed/album/fixture', height: 352 },
  ])(
    'uses the fixed $height pixel $provider player layout',
    async ({ provider, embedUrl, height }) => {
      const source = Schema.decodeUnknownSync(RichContentDocument)({
        version: 1,
        blocks: [
          {
            ...Block.ExternalMediaEmbed({
              provider: 'spotify',
              embedUrl,
              canonicalUrl: 'https://example.com/media',
              title: 'Audio fixture',
              aspectRatio: 16 / 9,
            }),
            provider,
          },
        ],
      })

      const view = element(await renderRichContent(source))
      expect(findAll(view, 'iframe')).toHaveLength(1)
      expect(attribute(first(findAll(view, '.rich-content-media-frame')), 'style')).toBe(
        `height:${height}px`,
      )
    },
  )
})
