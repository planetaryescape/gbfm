import {
  SOCIAL_CARD_DIMENSIONS,
  type SocialCardFormat,
  type SocialCardModel,
} from '@gbfm/social-card'
import { Resvg } from '@resvg/resvg-wasm'
import { Match } from 'effect'
import QRCode from 'qrcode'
import satori from 'satori/standalone'

import { initializeRuntime, type SocialCardRenderAssets } from './render-runtime'
import { socialCardTemplate } from './template'

export type { SocialCardRenderAssets } from './render-runtime'

const qrDataUrl = async (url: string) => {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    color: { dark: '#111827', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  })

  return `data:image/svg+xml;base64,${btoa(svg)}`
}

const hydrateImages = async (model: SocialCardModel, assets: SocialCardRenderAssets) => {
  return Match.value(model).pipe(
    Match.tag('ArtworkCard', async (card) => ({
      ...card,
      artworkUrl: card.artworkUrl ? await assets.loadImage(card.artworkUrl) : null,
    })),
    Match.tag('IdentityCard', async (card) => ({
      ...card,
      imageUrl: card.imageUrl ? await assets.loadImage(card.imageUrl) : null,
    })),
    Match.tag('EditorialCard', async (card) => ({
      ...card,
      imageUrl: card.imageUrl ? await assets.loadImage(card.imageUrl) : null,
    })),
    Match.tag('TweetCard', async (card) => {
      const [coverImageUrl, avatarUrl] = await Promise.all([
        card.coverImageUrl ? assets.loadImage(card.coverImageUrl) : null,
        card.avatarUrl ? assets.loadImage(card.avatarUrl) : null,
      ])

      return { ...card, coverImageUrl, avatarUrl }
    }),
    Match.exhaustive,
  )
}

/** Renders one normalized social card to its fixed-size PNG representation. */
export const renderSocialCard = async (
  model: SocialCardModel,
  format: SocialCardFormat,
  assets: SocialCardRenderAssets,
): Promise<Uint8Array> => {
  if (
    !Match.value(model).pipe(
      Match.tag('TweetCard', () => true),
      Match.orElse(() => false),
    ) &&
    format !== 'openGraph'
  ) {
    throw new Error(`${model._tag} does not support ${format}`)
  }

  await initializeRuntime(assets)

  const [bold, extraBold, hydratedModel, qrUrl] = await Promise.all([
    assets.loadFont('JetBrainsMono-Bold.ttf'),
    assets.loadFont('JetBrainsMono-ExtraBold.ttf'),
    hydrateImages(model, assets),
    Match.value(model).pipe(
      Match.tag('TweetCard', (card) => (format !== 'openGraph' ? qrDataUrl(card.url) : '')),
      Match.orElse(() => ''),
    ),
  ])

  const [width, height] = SOCIAL_CARD_DIMENSIONS[format]

  const svg = await satori(socialCardTemplate(hydratedModel, format, qrUrl), {
    width,
    height,
    fonts: [
      { name: 'JetBrains Mono', data: bold, weight: 600 },
      { name: 'JetBrains Mono', data: extraBold, weight: 900 },
    ],
  })

  const renderer = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: false },
  })

  try {
    return renderer.render().asPng()
  } finally {
    renderer.free()
  }
}
