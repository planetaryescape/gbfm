import * as Cloudflare from '@alchemy.run/cloudflare'
import { adopt } from 'alchemy/AdoptPolicy'
import * as Effect from 'effect/Effect'

import type { StageConfig } from './stage'

export const dnsRedirects = (config: StageConfig) =>
  Effect.gen(function* () {
    if (!config.isProduction) return

    const zone = yield* Cloudflare.Zone.Zone('Zone', { name: 'goosebumps.fm' }).pipe(adopt(true))

    // These served /rss.xml, /sitemap.xml and /s/* off the VPS. The Worker
    // serves the same routes, so they move with the client rather than
    // pointing at a host that is being retired.
    yield* Cloudflare.Ruleset.Ruleset('VpsRedirects', {
      zone,
      phase: 'http_request_dynamic_redirect',
      name: 'Dynamic route redirects',
      rules: [
        {
          action: 'redirect',
          description: 'Canonical HTTPS apex domain',
          expression: `(http.host eq "www.goosebumps.fm") or ((http.host eq "goosebumps.fm") and not ssl)`,
          actionParameters: {
            fromValue: {
              statusCode: 301,
              targetUrl: { expression: 'concat("https://goosebumps.fm", http.request.uri.path)' },
              preserveQueryString: true,
            },
          },
        },
        {
          action: 'redirect',
          description: 'Redirect RSS feeds to the API',
          expression: `((http.request.uri.path eq "/rss.xml") or (http.request.uri.path eq "/rss")) and (http.host eq "goosebumps.fm")`,
          actionParameters: {
            fromValue: { statusCode: 301, targetUrl: { value: `${config.apiUrl}/rss.xml` } },
          },
        },
        {
          action: 'redirect',
          description: 'Redirect sitemap to the API',
          expression: `(http.request.uri.path eq "/sitemap.xml") and (http.host eq "goosebumps.fm")`,
          actionParameters: {
            fromValue: { statusCode: 301, targetUrl: { value: `${config.apiUrl}/sitemap.xml` } },
          },
        },
        {
          action: 'redirect',
          description: 'Redirect share routes to the API OG handlers',
          expression: `starts_with(http.request.uri.path, "/s/") and (http.host eq "goosebumps.fm")`,
          actionParameters: {
            fromValue: {
              statusCode: 301,
              targetUrl: { expression: `concat("${config.apiUrl}", http.request.uri.path)` },
              preserveQueryString: true,
            },
          },
        },
      ],
    })
  })
