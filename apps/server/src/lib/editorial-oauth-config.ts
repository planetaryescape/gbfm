import {
  EditorialOAuthConfiguration,
  EditorialOAuthSettings,
  McpResourceUrl,
} from '@gbfm/core/editorial-mcp'
import { UserId } from '@gbfm/core/identity'
import { Match, Option, Schema } from 'effect'

export class EditorialOAuthConfigInvalid extends Schema.TaggedError<
  EditorialOAuthConfigInvalid,
  { readonly brand: unique symbol }
>()('EditorialOAuthConfigInvalid', {
  fields: Schema.Array(Schema.Literals(['MCP_OWNER_USER_ID', 'MCP_RESOURCE_URL'])),
}) {}

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
          }).pipe(
            Option.getOrThrowWith(() => {
              const fields: Array<'MCP_OWNER_USER_ID' | 'MCP_RESOURCE_URL'> = []

              if (!Schema.is(UserId)(owner?.trim())) fields.push('MCP_OWNER_USER_ID')

              if (!Schema.is(McpResourceUrl)(resource)) fields.push('MCP_RESOURCE_URL')

              return new EditorialOAuthConfigInvalid({ fields })
            }),
          ),
        })

  return Match.value(configuration).pipe(
    Match.tag('Disabled', () => undefined),
    Match.tag('Enabled', ({ settings }) => settings),
    Match.exhaustive,
  )
}
