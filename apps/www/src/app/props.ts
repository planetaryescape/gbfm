import { SiteMetadata } from '@gbfm/site-metadata'
import { Schema } from 'effect'

export const AppProps = Schema.Struct({
  url: Schema.URL,
  metadata: SiteMetadata,
})

export type AppProps = typeof AppProps.Type

export const AppPropsJson = Schema.toCodecJson(AppProps)

export const serializeAppProps = (props: AppProps): string =>
  JSON.stringify(Schema.encodeSync(AppPropsJson)(props)).replace(
    /[<\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
