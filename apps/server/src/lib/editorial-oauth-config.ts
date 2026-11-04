import { EditorialOAuthConfiguration, EditorialOAuthSettings } from '@gbfm/core/editorial-mcp'
import { Match, Option, Schema } from 'effect'

export class EditorialOAuthConfigInvalid extends Schema.TaggedError<
  EditorialOAuthConfigInvalid,
  { readonly brand: unique symbol }
>()('EditorialOAuthConfigInvalid', {}) {}

export function parseEditorialOAuthConfig(owner: string | undefined, resource: string | undefined) {
  const url = resource === undefined ? null : URL.parse(resource)

  const configuration: EditorialOAuthConfiguration =
    owner === undefined && resource === undefined
      ? EditorialOAuthConfiguration.cases.Disabled.make({})
      : EditorialOAuthConfiguration.cases.Enabled.make({
          settings: Schema.decodeUnknownOption(EditorialOAuthSettings)({
            ownerUserId: owner?.trim(),
            resourceUrl: resource,
            issuer: url ? `${url.origin}/auth` : undefined,
          }).pipe(Option.getOrThrowWith(() => new EditorialOAuthConfigInvalid())),
        })

  return Match.value(configuration).pipe(
    Match.tag('Disabled', () => undefined),
    Match.tag('Enabled', ({ settings }) => settings),
    Match.exhaustive,
  )
}
