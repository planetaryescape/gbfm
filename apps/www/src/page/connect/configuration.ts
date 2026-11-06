import { OAuthIssuerUrl } from '@gbfm/core/editorial-mcp'
import { Option, Schema } from 'effect'

export const connectionIssuer = async () => {
  const value = import.meta.env.PROD
    ? (await import('cloudflare:workers')).env.EDITORIAL_OAUTH_ISSUER
    : process.env.EDITORIAL_OAUTH_ISSUER

  return Option.getOrNull(Schema.decodeUnknownOption(OAuthIssuerUrl)(value))
}
