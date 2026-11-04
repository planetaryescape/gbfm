import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import { Random } from 'alchemy/Random'
import { retain } from 'alchemy/RemovalPolicy'
import * as Effect from 'effect/Effect'

import { apiWorker } from './alchemy/api'
import { cdnRouter } from './alchemy/cdn'
import { deploymentConfig } from './alchemy/config'
import { dnsRedirects } from './alchemy/dns'
import { emailResources } from './alchemy/email'
import { qrPdfWorker } from './alchemy/qr-pdf'
import { secretsStore } from './alchemy/secrets'
import { socialImageWorker } from './alchemy/social-image'
import { stageConfig } from './alchemy/stage'
import { stackState } from './alchemy/state'
import { storage } from './alchemy/storage'
import { website } from './alchemy/www'
import { emailDeploymentConfig } from './apps/server/src/email-deployment-config'

export default Alchemy.Stack(
  'gbfm',
  {
    providers: Cloudflare.providers(),
    state: stackState,
  },
  Effect.gen(function* () {
    const config = yield* stageConfig
    const deployment = yield* deploymentConfig(config.isLocalDev)
    const secrets = yield* secretsStore(config.apiUrl, config.isLocalDev, deployment.secrets)

    const emailConfig = emailDeploymentConfig({
      stage: config.stage,
      testRecipient: deployment.emailTestRecipient,
      localDev: config.isLocalDev,
    })

    const email = yield* emailResources(config, emailConfig)
    const store = yield* storage(config)
    const mediaPreviewKey = yield* Random('MediaPreviewKey', { bytes: 32 })
    const cdn = yield* cdnRouter(config, store, mediaPreviewKey.text)
    const qrPdf = yield* qrPdfWorker(config, store, cdn)

    const turnstile = yield* Cloudflare.Turnstile.Widget('SignupTurnstile', {
      domains: config.isProduction
        ? ['goosebumps.fm', 'www.goosebumps.fm']
        : ['goosebumps.fm', 'www.goosebumps.fm', 'gbfm.localhost', 'localhost', '127.0.0.1'],
      mode: 'managed',
    })

    const api = yield* apiWorker({
      config,
      store,
      secrets,
      email,
      emailConfig,
      cdn,
      qrPdf,
      adminEmail: deployment.adminEmail,
      cloudflareAccountId: deployment.cloudflareAccountId,
      turnstile,
      mediaPreviewKey: mediaPreviewKey.text,
    })

    if (email !== undefined) {
      yield* Cloudflare.KV.Namespace('TelemetryEvaluatorState').pipe(retain())
    }

    const socialImages = yield* socialImageWorker(config, store, api)

    yield* dnsRedirects(config)

    const www = yield* website({
      config,
      websiteConfig: deployment.website,
      api,
      socialImages,
      apiUrl: api.url,
      turnstileSitekey: turnstile.sitekey,
    })

    return {
      apiUrl: api.url,
      apiDomains: api.urls,
      cdnRouterUrl: cdn.url,
      cdnRouterDomains: cdn.urls,
      wwwUrl: www.url,
      wwwDomains: www.urls,
      databaseName: store.db.databaseName,
      userContentBucketName: store.userContent.bucketName,
      mixesBucketName: store.mixes.bucketName,
      socialCardsBucketName: store.socialCards.bucketName,
    }
  }),
)
