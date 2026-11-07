import { EditorialOAuthConfiguration, EditorialOAuthSettings } from '@gbfm/core/editorial-mcp'
import { Match, Option, Schema } from 'effect'

export class EditorialOAuthConfigInvalid extends Schema.TaggedError<
  EditorialOAuthConfigInvalid,
  { readonly brand: unique symbol }
>()('EditorialOAuthConfigInvalid', {
  fields: Schema.Array(Schema.Literal('SHARE_URL')),
}) {}

export function parseEditorialOAuthConfig(apiUrl: string) {
  const url = URL.parse(apiUrl)

  const localHttp =
    url?.protocol === 'http:' &&
    (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.hostname.endsWith('.localhost'))

  const configuration: EditorialOAuthConfiguration = localHttp
    ? EditorialOAuthConfiguration.cases.Disabled.make({})
    : EditorialOAuthConfiguration.cases.Enabled.make({
        settings: Schema.decodeUnknownOption(EditorialOAuthSettings)({
          resourceUrl: url && !url.username && !url.password ? `${url.origin}/mcp` : undefined,
          issuer: url ? `${url.origin}/auth` : undefined,
        }).pipe(
          Option.getOrThrowWith(() => new EditorialOAuthConfigInvalid({ fields: ['SHARE_URL'] })),
        ),
      })

  return Match.value(configuration).pipe(
    Match.tag('Disabled', () => undefined),
    Match.tag('Enabled', ({ settings }) => settings),
    Match.exhaustive,
  )
}
