import { Schema } from 'effect'

import { SpotifyCallbackApplicationProps } from '../features/spotify/callback-application'
import { PublicCredentialBootstrap } from './credential-application'
import { isPageUrl } from './route'
import { AppBootstrap } from './routed-application'

export const Bootstrap = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('routed'),
    ...AppBootstrap.fields,
    url: Schema.URL.check(
      Schema.makeFilter(
        (url) =>
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          isPageUrl(url),
      ),
    ),
  }),
  PublicCredentialBootstrap,
  Schema.Struct({
    kind: Schema.Literal('spotify-callback'),
    ...SpotifyCallbackApplicationProps.fields,
  }),
])

export type Bootstrap = typeof Bootstrap.Type

export const BootstrapJson = Schema.toCodecJson(Bootstrap)

export const serializeBootstrap = (bootstrap: Bootstrap): string =>
  JSON.stringify(Schema.encodeSync(BootstrapJson)(bootstrap)).replace(
    /[<\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
