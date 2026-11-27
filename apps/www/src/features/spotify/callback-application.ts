import { Html, HtmlHead } from '@effect/ui/html'
import { makeStaticSiteMetadata, SiteMetadata } from '@gbfm/site-metadata'
import { Schema } from 'effect'

import { siteHead } from '../../app/head'
import { Principal } from '../../domain/principal'
import { wordmark } from '../../ui/wordmark'
import { SpotifyCallback } from './actions'
import { spotifyCallbackPath } from './callback-url'
import { SpotifyProvider } from './provider'

export const spotifyCallbackMetadata = makeStaticSiteMetadata(
  'Connecting Spotify',
  'Completing your Spotify authorization on goosebumps.fm.',
  spotifyCallbackPath,
)

export const spotifyCallbackHeaders = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
}

const equivalentMetadata = Schema.toEquivalence(SiteMetadata)

const CallbackMetadata = SiteMetadata.check(
  Schema.makeFilter((metadata) => equivalentMetadata(metadata, spotifyCallbackMetadata), {
    message: 'Expected fixed Spotify callback metadata.',
    reportInput: false,
  }),
)

export const SpotifyCallbackApplicationProps = Schema.Struct({
  url: Schema.Literal(spotifyCallbackPath),
  metadata: CallbackMetadata,
  principal: Schema.NullOr(Principal),
  principalKnown: Schema.Boolean,
})

export type SpotifyCallbackApplicationProps = typeof SpotifyCallbackApplicationProps.Type

export const makeSpotifyCallbackProps = (input: {
  readonly principal: typeof Principal.Type | null
  readonly principalKnown: boolean
}): SpotifyCallbackApplicationProps =>
  SpotifyCallbackApplicationProps.make({
    url: spotifyCallbackPath,
    metadata: spotifyCallbackMetadata,
    principal: input.principal,
    principalKnown: input.principalKnown,
  })

export const SpotifyCallbackApplication = Html.component({
  name: 'SpotifyCallbackApplication',
  props: SpotifyCallbackApplicationProps,
  model: Schema.Null,
  message: Schema.Never,
  restore: false,
}).make({
  init: () => null,
  update: ($) => $.model,
  head: ({ props }) => [
    ...siteHead(props.metadata),
    HtmlHead.meta({ name: 'robots', content: 'noindex,nofollow' }),
    HtmlHead.meta({ name: 'referrer', content: 'no-referrer' }),
  ],
  view: (h) =>
    SpotifyProvider(h, {
      props: { identity: h.props.principal?.id ?? 'anonymous' },
      view: () =>
        h.div
          .class('min-h-dvh bg-background text-foreground')
          .children(
            h.header
              .class('border-b border-border p-4')
              .children(
                h.a
                  .attr('href', '/')
                  .attr('aria-label', 'goosebumps.fm home')
                  .class('inline-block w-48 text-foreground')
                  .children(wordmark(h)),
              ),
            h.main.children(SpotifyCallback(h, {})),
          ),
    }),
})

export { spotifyCommandsLayer as spotifyCallbackLayer } from './commands'
