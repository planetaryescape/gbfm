import { describe, expect, test } from 'vitest'

import {
  buildSocialCardPresentation,
  buildTweetCardPresentation,
  SOCIAL_CARD_DIMENSIONS,
  TWEET_CARD_FORMATS,
} from './index'

const artworkInput = {
  kind: 'mix' as const,
  slug: 'forest-drive-west-at-gbfm',
  title: 'Forest Drive West at goosebumps.fm',
  creators: ['Forest Drive West'],
  imageUrl: 'https://cdn.goosebumps.fm/mix.png',
}

const preHarfBuzzRevisions = {
  artwork: '257384c7e6c52124',
  identity: '0b8adac5e42f7a39',
  editorial: '21b3f1fc990da8a0',
  tweet: 'd610762aadde571f',
} as const

describe('social card presentation', () => {
  test('uses saved mosaic artwork in tweet exports without changing attached music', async () => {
    const input = {
      slug: 'mosaic-check',
      commentary: 'Listening notes',
      createdAt: '2026-10-31T12:00:00.000Z',
      creator: null,
      entity: {
        type: 'album' as const,
        title: 'Album',
        artists: ['Artist'],
        coverImageUrl: 'https://i.scdn.co/original.png',
      },
    }

    const original = await buildTweetCardPresentation(input)

    const mosaic = await buildTweetCardPresentation({
      ...input,
      artworkUrl: 'https://cdn.goosebumps.fm/user-content/mosaic.png',
    })

    expect(original.model.coverImageUrl).toBe(input.entity.coverImageUrl)
    expect(mosaic.model.coverImageUrl).toBe('https://cdn.goosebumps.fm/user-content/mosaic.png')
    expect(mosaic.model.entityTitle).toBe('Album')
    expect(mosaic.revision).not.toBe(original.revision)
    expect(
      (await buildTweetCardPresentation({ ...input, artworkUrl: '' })).model.coverImageUrl,
    ).toBe(input.entity.coverImageUrl)
  })
  test('builds one immutable Open Graph image for artwork-led content', async () => {
    const presentation = await buildSocialCardPresentation(artworkInput)

    expect(presentation.schemaVersion).toBe(1)
    expect(presentation.model._tag).toBe('ArtworkCard')
    expect(presentation.model).toMatchObject({
      kind: 'mix',
      title: artworkInput.title,
      creators: artworkInput.creators,
      artworkUrl: artworkInput.imageUrl,
    })
    expect(presentation.revision).toMatch(/^[a-f0-9]{16}$/)
    expect(presentation.revision).not.toBe(preHarfBuzzRevisions.artwork)
    expect(presentation.images).toEqual({
      openGraph: `https://goosebumps.fm/social/cards/mix/${artworkInput.slug}/${presentation.revision}/open-graph.png`,
    })
    expect(SOCIAL_CARD_DIMENSIONS.openGraph).toEqual([1200, 630])
  })

  test('changes only the affected presentation revision', async () => {
    const original = await buildSocialCardPresentation(artworkInput)

    const edited = await buildSocialCardPresentation({
      ...artworkInput,
      title: 'Forest Drive West — live',
    })

    expect(edited.revision).not.toBe(original.revision)
  })

  test('selects identity and editorial layouts from their content kinds', async () => {
    const show = await buildSocialCardPresentation({
      kind: 'show',
      slug: 'far-end-radio',
      title: 'Far End Radio',
      description: 'An open-ended monthly radio residency.',
      detail: 'Hosted by Guide Fari',
      imageUrl: null,
    })

    const editorial = await buildSocialCardPresentation({
      kind: 'editorial',
      slug: 'active-passive',
      title: 'Active / Passive',
      description: 'Notes on listening with intent.',
      authors: ['Guide Fari'],
      imageUrl: null,
      publishedAt: '2026-09-18T23:30:00.000-08:00',
    })

    expect(show.model._tag).toBe('IdentityCard')
    expect(show.revision).not.toBe(preHarfBuzzRevisions.identity)
    expect(show.model).toMatchObject({
      kind: 'show',
      eyebrow: 'Radio show',
      detail: 'Hosted by Guide Fari',
    })
    expect(editorial.model._tag).toBe('EditorialCard')
    expect(editorial.revision).not.toBe(preHarfBuzzRevisions.editorial)
    expect(editorial.model).toMatchObject({
      kind: 'editorial',
      authors: ['Guide Fari'],
      publishedLabel: 'Sep 19, 2026',
    })
  })

  test('preserves the three tweet export formats on the shared route family', async () => {
    const presentation = await buildTweetCardPresentation({
      slug: 'vusa-just-resurfaced',
      commentary: 'Vusa just resurfaced this. Pairs well with the lounge.',
      createdAt: '2026-09-12T23:30:00.000-08:00',
      creator: {
        name: 'Guide Fari',
        username: 'guidefari',
        avatarUrl: 'https://cdn.goosebumps.fm/user-content/avatar.png',
      },
      entity: {
        type: 'album',
        title: 'A Long Way From Home',
        artists: ['Vusa Mkhaya', 'M3NSA'],
        coverImageUrl: 'https://cdn.goosebumps.fm/user-content/cover.png',
      },
    })

    expect(presentation.model.kind).toBe('tweet')
    expect(presentation.revision).not.toBe(preHarfBuzzRevisions.tweet)
    expect(presentation.model._tag).toBe('TweetCard')
    expect(presentation.model.entityLabel).toBe('Album')
    expect(Object.keys(presentation.images)).toEqual(TWEET_CARD_FORMATS)
    expect(presentation.images.openGraph).toContain('/social/cards/tweet/vusa-just-resurfaced/')
  })
})
