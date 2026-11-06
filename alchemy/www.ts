import * as Cloudflare from 'alchemy/Cloudflare'
import * as Output from 'alchemy/Output'
import * as Effect from 'effect/Effect'

import type { WebsiteConfig } from './config'
import { workerObservability } from './observability'
import type { SocialImageWorker } from './social-image'
import type { StageConfig } from './stage'

export interface WebsiteInput {
  readonly config: StageConfig
  readonly websiteConfig: WebsiteConfig
  readonly api: Cloudflare.Worker
  readonly socialImages: SocialImageWorker
  readonly apiUrl: Output.Output<string | undefined>
  readonly turnstileSitekey: Output.Output<string>
}

const requireApiUrl = (url: string | undefined) => {
  if (url === undefined) throw new Error('Api Worker URL is missing')

  return url
}

export const website = ({
  config,
  websiteConfig,
  api,
  socialImages,
  apiUrl,
  turnstileSitekey,
}: WebsiteInput) =>
  Effect.gen(function* () {
    const browserTelemetry = yield* Cloudflare.AnalyticsEngine.Dataset('BrowserTelemetry', {
      dataset: `gbfm_www_${config.stage}`,
    })

    const worker = {
      main: './apps/www/dist/server/fetch.js',
      ...(config.isProduction
        ? { domain: { name: 'www.goosebumps.fm', aliases: ['goosebumps.fm'] } }
        : { url: true }),
      observability: workerObservability(config.isProduction),
      env: {
        API: api,
        TURNSTILE_SITE_KEY: turnstileSitekey,
        SOCIAL_IMAGES: socialImages,
        BROWSER_TELEMETRY: browserTelemetry,
        BROWSER_TELEMETRY_RATE_LIMIT: Cloudflare.RateLimit('BrowserTelemetryRateLimit', {
          namespaceId: 1_001,
          simple: { limit: 30, period: 60 },
        }),
        BROWSER_TELEMETRY_ORIGIN: config.isProduction
          ? 'https://goosebumps.fm'
          : `https://${config.stage}.goosebumps.fm`,
        APP_STAGE: config.stage,
        APP_RELEASE: config.release,
        ...(config.isLocalDev
          ? { VPS_PROXY_TARGET: Output.map(apiUrl, requireApiUrl) }
          : undefined),
        VITE_SPOTIFY_CLIENT_ID: websiteConfig.spotifyClientId,
      },
    }

    // Cmdz owns Vite in dev; StaticSite.dev would start a second Web process.
    if (config.isLocalDev)
      return yield* Cloudflare.Worker('Www', {
        ...worker,
        dev: { mode: 'external', url: 'https://gbfm.localhost' },
      })

    return yield* Cloudflare.Website.StaticSite('Www', {
      ...worker,
      cwd: 'apps/www',
      command: 'bun run build',
      outdir: 'dist/client',
      assets: {
        notFoundHandling: '404-page',
        runWorkerFirst: false,
      },
    })
  })
