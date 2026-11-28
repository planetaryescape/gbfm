import { Html, HtmlHead } from '@effect/ui/html'
import { SiteMetadata } from '@gbfm/site-metadata'
import { Option, Redacted, Schema } from 'effect'

import { AuthPage } from '../features/account/auth-page'
import { NewsletterPage } from '../features/newsletter/page'
import { siteHead } from './head'
import { ThemeButton } from './theme-button'

const safePublicUrl = (url: URL) =>
  ['http:', 'https:'].includes(url.protocol) &&
  !url.username &&
  !url.password &&
  !url.hash &&
  !url.searchParams.has('token')

export const SafeCredentialUrl = Schema.URL.check(
  Schema.makeFilter(
    (url) =>
      safePublicUrl(url) &&
      ['/auth/reset-password', '/subscribe', '/unsubscribe'].includes(url.pathname),
  ),
)

const safeMetadata = SiteMetadata.check(
  Schema.makeFilter((metadata) =>
    [metadata.canonicalUrl, metadata.image.url, metadata.audio?.url].every((value) => {
      if (value === undefined) return true
      const url = URL.parse(value)

      return url !== null && safePublicUrl(url)
    }),
  ),
)

export const CredentialApplicationProps = Schema.Struct({
  url: SafeCredentialUrl,
  metadata: SiteMetadata,
  token: Schema.optional(Schema.Redacted(Schema.String)),
  turnstileSiteKey: Schema.optional(Schema.String),
})

export type CredentialApplicationProps = typeof CredentialApplicationProps.Type

export const PublicCredentialBootstrap = Schema.Struct({
  kind: Schema.Literal('credential'),
  url: SafeCredentialUrl,
  metadata: safeMetadata,
  turnstileSiteKey: Schema.optional(Schema.String),
})

export type PublicCredentialBootstrap = typeof PublicCredentialBootstrap.Type

export const PublicCredentialBootstrapJson = Schema.toCodecJson(PublicCredentialBootstrap)

const CredentialBootstrapInput = Schema.Union([
  Schema.toType(PublicCredentialBootstrap),
  PublicCredentialBootstrapJson,
])

export type CredentialBootstrapInput = typeof CredentialBootstrapInput.Encoded

const stripToken = (value: string | URL) => {
  const url = URL.parse(String(value))

  if (!url) throw new Error('Invalid credential URL')
  url.searchParams.delete('token')
  url.hash = ''

  return url
}

const projectMetadata = (metadata: SiteMetadata): SiteMetadata => ({
  schemaVersion: metadata.schemaVersion,
  kind: metadata.kind,
  title: metadata.title,
  description: metadata.description,
  canonicalUrl: stripToken(metadata.canonicalUrl).href,
  image: {
    url: stripToken(metadata.image.url).href,
    alt: metadata.image.alt,
    width: metadata.image.width,
    height: metadata.image.height,
  },
  creators: [...metadata.creators],
  publishedAt: metadata.publishedAt,
  modifiedAt: metadata.modifiedAt,
  audio:
    metadata.audio === null
      ? null
      : {
          url: stripToken(metadata.audio.url).href,
          mimeType: metadata.audio.mimeType,
        },
})

export const makeCredentialProps = (
  rawUrl: string | URL,
  metadata: SiteMetadata,
  turnstileSiteKey?: string,
): CredentialApplicationProps => {
  const raw = URL.parse(String(rawUrl))

  if (!raw) throw new Error('Invalid credential URL')
  const token = raw.searchParams.get('token')
  const url = stripToken(raw)

  if (!Schema.is(SafeCredentialUrl)(url)) throw new Error('Invalid credential URL')
  const publicMetadata = projectMetadata(metadata)

  if (
    token &&
    (url.href.includes(token) ||
      JSON.stringify(publicMetadata).includes(token) ||
      turnstileSiteKey?.includes(token))
  )
    throw new Error('Credential metadata contains private material')

  if (!Schema.is(safeMetadata)(publicMetadata)) throw new Error('Invalid credential metadata')

  return {
    url,
    metadata: publicMetadata,
    token: token === null ? undefined : Redacted.make(token),
    turnstileSiteKey,
  }
}

export const serializeCredentialBootstrap = (props: CredentialApplicationProps): string => {
  if (!Schema.is(SafeCredentialUrl)(props.url) || !Schema.is(safeMetadata)(props.metadata))
    throw new Error('Invalid credential bootstrap')

  const projection: PublicCredentialBootstrap = {
    kind: 'credential',
    url: props.url,
    metadata: projectMetadata(props.metadata),
    turnstileSiteKey: props.turnstileSiteKey,
  }

  const serialized = JSON.stringify(Schema.encodeSync(PublicCredentialBootstrapJson)(projection))

  if (props.token && serialized.includes(Redacted.value(props.token)))
    throw new Error('Invalid credential bootstrap')

  return serialized.replace(
    /[<\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

export interface CredentialDocument {
  readonly querySelector: (selector: string) => {
    readonly getAttribute: (name: string) => string | null
  } | null
}

export const readCredentialProps = (
  bootstrap: CredentialBootstrapInput,
  document: CredentialDocument,
): CredentialApplicationProps => {
  const decoded = Schema.decodeUnknownOption(CredentialBootstrapInput)(bootstrap)

  if (Option.isNone(decoded)) throw new Error('Invalid credential bootstrap')

  const path = decoded.value.url.pathname
  const action = path === '/auth/reset-password' ? path : `/actions${path}`

  const token = document
    .querySelector(`form[action='${action}'] input[type=hidden][name=token]`)
    ?.getAttribute('value')

  if (
    token &&
    (decoded.value.url.href.includes(token) ||
      JSON.stringify(decoded.value.metadata).includes(token) ||
      decoded.value.turnstileSiteKey?.includes(token))
  )
    throw new Error('Invalid credential bootstrap')

  return {
    url: decoded.value.url,
    metadata: decoded.value.metadata,
    token: token ? Redacted.make(token) : undefined,
    turnstileSiteKey: decoded.value.turnstileSiteKey,
  }
}

export const CredentialApplication = Html.component({
  name: 'CredentialApplication',
  props: CredentialApplicationProps,
  model: Schema.Struct({}),
  message: Schema.Never,
  restore: false,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  head: ({ props }) => [
    ...siteHead(props.metadata),
    HtmlHead.meta({ name: 'robots', content: 'noindex, nofollow' }),
    HtmlHead.meta({ name: 'referrer', content: 'no-referrer' }),
  ],
  view: (h) =>
    h.div.class('site').children(
      h.header
        .class('mx-auto flex w-full items-center justify-between px-4 py-6')
        .children(
          h.a.attr('href', '/').class('font-bold').children('goosebumps.fm'),
          ThemeButton(h, {}),
        ),
      h.main.children(
        h.props.url.pathname === '/auth/reset-password'
          ? AuthPage(h, {
              props: {
                action: 'reset-password',
                url: h.props.url.href,
                token: h.props.token,
              },
            })
          : NewsletterPage(h, {
              props: {
                mode: h.props.url.pathname.slice(1),
                url: h.props.url.href,
                token: h.props.token,
                turnstileSiteKey: h.props.turnstileSiteKey,
              },
            }),
      ),
    ),
})
