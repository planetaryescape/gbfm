import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Effect from 'effect/Effect'

import type { EmailDeploymentConfig } from '../apps/server/src/email-deployment-config'
import type { StageConfig } from './stage'

export const emailResources = (config: StageConfig, emailConfig: EmailDeploymentConfig) =>
  Effect.gen(function* () {
    if (emailConfig.transport === 'recording') return undefined

    const routing = yield* Cloudflare.Email.Routing('EmailRouting', { zone: 'goosebumps.fm' })
    yield* Cloudflare.Email.SendingSubdomain('EmailSending', {
      zoneId: routing.zoneId,
      name: emailConfig.sendingDomain,
    })

    if (config.isProduction) {
      return yield* Cloudflare.Email.SendEmail('EMAIL', {
        allowedSenderAddresses: [emailConfig.emailSender],
      })
    }

    const destinationAddress = emailConfig.destinationAddress

    if (destinationAddress === undefined) {
      return yield* Effect.die(new Error('Non-production email requires a destination address'))
    }

    return yield* Cloudflare.Email.SendEmail('EMAIL', {
      allowedSenderAddresses: [emailConfig.emailSender],
      destinationAddress,
    })
  })

export type EmailResources = Effect.Success<ReturnType<typeof emailResources>>
