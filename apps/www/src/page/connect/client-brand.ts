import { Schema } from 'effect'

export const ClientBrand = Schema.Literal('opencode')

export type ClientBrand = typeof ClientBrand.Type

export const identifyClientBrand = (client: {
  readonly client_uri?: string | undefined
  readonly logo_uri?: string | undefined
}): ClientBrand | undefined =>
  client.client_uri === 'https://opencode.ai' &&
  client.logo_uri === 'https://opencode.ai/web-app-manifest-512x512.png'
    ? 'opencode'
    : undefined
