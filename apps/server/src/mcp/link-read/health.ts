import { Context, Effect, Layer, Option, Result, Schema } from 'effect'

import { parseMusicSource } from '@/services/canonical-music-identity/music-source'

import type { HealthObservation } from './contracts'

/**
 * Trusted egress boundary: MUST block private/special-use destination IPs on the actual
 * connection (including DNS rebinding), omit credentials, never follow redirects and
 * cancel/close HEAD response bodies without buffering. No raw-fetch fallback is safe.
 */
export class LinkHealthEgress extends Context.Service<
  LinkHealthEgress,
  {
    readonly head: (url: string, signal: AbortSignal) => Promise<typeof HeadResponse.Type | null>
  }
>()('gbfm/mcp/LinkHealthEgress') {}

/** Fail closed until the integration owner supplies an approved private-network-blocked transport. */
export const LinkHealthUnavailable = Layer.succeed(LinkHealthEgress, {
  head: async () => null,
})

const HeadResponse = Schema.Struct({
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  location: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
})

const allowedHosts = new Set(['open.spotify.com', 'www.deezer.com', 'www.youtube.com'])

const allowed = (value: string) => {
  const url = URL.parse(value)

  return url &&
    url.protocol === 'https:' &&
    !url.port &&
    !url.username &&
    !url.password &&
    allowedHosts.has(url.hostname)
    ? url.href
    : null
}

/** At most three HEADs, two validated redirects, zero buffered body bytes, four seconds total. */
export const inspectLinkHealth = Effect.fn('LinkRead.inspectHealth')(function* (url: string) {
  const egress = yield* LinkHealthEgress
  let requests = 0

  const observe = (
    status: typeof HealthObservation.Type.status,
    reason: typeof HealthObservation.Type.reason,
    httpStatus: number | null = null,
  ): typeof HealthObservation.Type => ({
    status,
    reason,
    httpStatus,
    requests,
    checkedAt: new Date().toISOString(),
  })

  const work = Effect.gen(function* () {
    let target = allowed(url)

    for (let hop = 0; hop <= 2; hop += 1) {
      if (target === null) return observe('blocked', 'unsupported_destination')
      const source = yield* parseMusicSource(target).pipe(Effect.result)

      if (
        Result.isFailure(source) ||
        !['spotify', 'deezer', 'youtube'].includes(source.success.platform)
      )
        return observe('blocked', 'unsupported_destination')
      requests += 1
      const destination = target

      const response = yield* Effect.tryPromise({
        try: (signal) => egress.head(destination, signal),
        catch: () => 'transport_unavailable' as const,
      }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(HeadResponse)), Effect.result)

      if (Result.isFailure(response))
        return observe('provider_unavailable', 'transport_unavailable')
      const { status, location } = response.success

      if (status >= 300 && status < 400) {
        if (location === null) return observe('provider_unavailable', 'http_status', status)
        const next = URL.parse(location, target)

        if (next === null || allowed(next.href) === null)
          return observe('blocked', 'unsupported_destination', status)

        if (hop === 2) return observe('blocked', 'redirect_limit', status)
        target = next.href
        continue
      }

      return status >= 200 && status < 300
        ? observe('reachable', 'http_status', status)
        : status === 404 || status === 410
          ? observe('not_found', 'http_status', status)
          : observe('provider_unavailable', 'http_status', status)
    }

    return observe('blocked', 'redirect_limit')
  })

  return yield* work.pipe(
    Effect.timeoutOption('4 seconds'),
    Effect.map(Option.getOrElse(() => observe('provider_unavailable', 'timeout'))),
  )
})
