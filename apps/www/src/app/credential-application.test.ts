import { MessageLog } from '@effect/ui'
import { HtmlServer } from '@effect/ui/html'
import { expect, it } from '@effect/vitest'
import { makeSiteMetadata } from '@gbfm/site-metadata'
import { Effect, Predicate, Redacted, Schema } from 'effect'

import {
  CredentialApplication,
  makeCredentialProps,
  PublicCredentialBootstrap,
  readCredentialProps,
  serializeCredentialBootstrap,
} from './credential-application'

const token = 'disposable-credential-fixture-never-in-bootstrap'

const rawUrl = `https://example.test/auth/reset-password?token=${token}&returnTo=%2Flistening`

const metadata = makeSiteMetadata({
  kind: 'page',
  title: 'Reset your password',
  description: 'Choose a new password.',
  canonicalUrl: rawUrl,
  imageUrl: null,
  imageAlt: 'Goosebumps FM',
  creators: [],
  publishedAt: null,
  modifiedAt: null,
  audio: null,
})

it('renders a usable no-JS reset form without serializing its bearer token into state, bootstrap or log strings', () =>
  Effect.gen(function* () {
    const props = makeCredentialProps(rawUrl, metadata)
    const log = MessageLog.makeMemory()

    const rendered = yield* HtmlServer.renderToHtml(CredentialApplication, props).pipe(
      Effect.provideService(MessageLog.MessageLog, log),
    )

    const bootstrap = serializeCredentialBootstrap(props)
    expect(rendered.html).toContain('method="post"')
    expect(rendered.html).toContain('action="/auth/reset-password"')
    expect(rendered.html).toContain('name="token"')
    expect(rendered.html).toContain(`value="${token}"`)
    expect(rendered.html).toContain('name="password"')
    expect(rendered.html).toContain('href="/"')
    expect(bootstrap).not.toContain(token)
    expect(bootstrap).not.toContain('"token"')
    expect(HtmlServer.serializeState(rendered.state)).not.toContain(token)
    expect(JSON.stringify(log.entries())).not.toContain(token)
    expect(
      log
        .entries()
        .filter(
          (entry) =>
            Predicate.isTagged(entry, 'Failed') || Predicate.isTagged(entry, 'LayerFailed'),
        ),
    ).toEqual([])
    expect(rendered.head).not.toContain(token)
    expect(props.url.searchParams.has('token')).toBe(false)
    expect(props.metadata.canonicalUrl).not.toContain(token)
  }).pipe(Effect.scoped, Effect.runPromise))

it('recovers the token only from the SSR reset form before hydration', () => {
  const props = makeCredentialProps(rawUrl, metadata)

  const bootstrap = Schema.decodeUnknownSync(Schema.toCodecJson(PublicCredentialBootstrap))(
    JSON.parse(serializeCredentialBootstrap(props)),
  )

  const selectors: Array<string> = []

  const recovered = readCredentialProps(bootstrap, {
    querySelector: (selector) => {
      selectors.push(selector)

      return { getAttribute: (name) => (name === 'value' ? token : null) }
    },
  })

  expect(selectors).toEqual(["form[action='/auth/reset-password'] input[type=hidden][name=token]"])
  expect(recovered.token && Redacted.value(recovered.token)).toBe(token)
  expect(recovered.url.href).toBe(props.url.href)
  expect(serializeCredentialBootstrap(recovered)).not.toContain(token)
})

it('rejects raw token-bearing or credential-bearing bootstrap URLs without echoing their contents', () => {
  const safe = makeCredentialProps(rawUrl, metadata)
  const unsafe = { ...safe, url: new URL(rawUrl) }
  expect(() => serializeCredentialBootstrap(unsafe)).toThrow('Invalid credential bootstrap')
  expect(() =>
    serializeCredentialBootstrap({
      ...safe,
      metadata: { ...safe.metadata, title: token },
    }),
  ).toThrow('Invalid credential bootstrap')
  expect(() =>
    serializeCredentialBootstrap({
      ...safe,
      url: new URL('https://fixture-user@example.test/auth/reset-password'),
    }),
  ).toThrow('Invalid credential bootstrap')
  expect(() =>
    readCredentialProps(
      {
        kind: 'credential',
        url: rawUrl,
        metadata: safe.metadata,
      },
      { querySelector: () => null },
    ),
  ).toThrow('Invalid credential bootstrap')
  expect(
    Schema.decodeUnknownOption(PublicCredentialBootstrap)({
      kind: 'credential',
      url: rawUrl,
      metadata: safe.metadata,
    })._tag,
  ).toBe('None')
})

it('a missing SSR token cannot become a hydrated reset form', () =>
  Effect.gen(function* () {
    const safe = makeCredentialProps(rawUrl, metadata)

    const bootstrap = yield* Schema.decodeUnknownEffect(
      Schema.toCodecJson(PublicCredentialBootstrap),
    )(JSON.parse(serializeCredentialBootstrap(safe)))

    const props = readCredentialProps(bootstrap, { querySelector: () => null })
    const rendered = yield* HtmlServer.renderToHtml(CredentialApplication, props)
    expect(rendered.html).toContain('Request a new link')
    expect(rendered.html).not.toContain('name="password"')
    expect(rendered.html).not.toContain(token)
  }).pipe(Effect.scoped, Effect.runPromise))

it.each([
  { path: '/auth/reset-password', action: '/auth/reset-password', label: 'Reset your password' },
  { path: '/unsubscribe', action: '/actions/unsubscribe', label: 'Confirm unsubscribe' },
  { path: '/subscribe', action: '/actions/subscribe', label: 'Subscribe' },
])(
  'isolates $path SSR credentials and recovers only its matching hidden POST field',
  ({ path, action, label }) =>
    Effect.gen(function* () {
      const url = new URL(path, 'https://example.test')
      url.searchParams.set('token', token)

      const props = makeCredentialProps(
        url,
        { ...metadata, canonicalUrl: url.href },
        'public-sitekey',
      )

      const log = MessageLog.makeMemory()

      const rendered = yield* HtmlServer.renderToHtml(CredentialApplication, props).pipe(
        Effect.provideService(MessageLog.MessageLog, log),
      )

      expect(rendered.html).toContain(`action="${action}"`)
      expect(rendered.html).toContain('method="post"')
      expect(rendered.html).toContain(label)

      const form = rendered.html.match(
        new RegExp(`<form\\b[^>]*action="${action}"[^>]*>([\\s\\S]*?)</form>`),
      )?.[1]

      expect(form).toBeDefined()
      const hidden = form?.match(/<input\b(?=[^>]*type="hidden")(?=[^>]*name="token")[^>]*>/)?.[0]
      const value = hidden?.match(/\bvalue="([^"]*)"/)?.[1]
      expect(value).toBe(token)
      const serialized = serializeCredentialBootstrap(props)
      expect(serialized).toContain('public-sitekey')
      expect(serialized).not.toContain(token)
      expect(HtmlServer.serializeState(rendered.state)).not.toContain(token)
      expect(JSON.stringify(log.entries())).not.toContain(token)
      expect(rendered.head).not.toContain(token)
      expect(rendered.head).toContain('noindex, nofollow')
      expect(rendered.head).toContain('no-referrer')

      const bootstrap = yield* Schema.decodeUnknownEffect(
        Schema.toCodecJson(PublicCredentialBootstrap),
      )(JSON.parse(serialized))

      const selectors: Array<string> = []

      const recovered = readCredentialProps(bootstrap, {
        querySelector: (selector) => {
          selectors.push(selector)

          return selector === `form[action='${action}'] input[type=hidden][name=token]` && value
            ? { getAttribute: (name) => (name === 'value' ? value : null) }
            : null
        },
      })

      expect(selectors).toEqual([`form[action='${action}'] input[type=hidden][name=token]`])
      expect(recovered.token && Redacted.value(recovered.token)).toBe(token)
      expect(recovered.turnstileSiteKey).toBe('public-sitekey')
      expect(serializeCredentialBootstrap(recovered)).not.toContain(token)
      const hydrated = yield* HtmlServer.renderToHtml(CredentialApplication, recovered)
      expect(hydrated.html).toContain(`value="${token}"`)
      expect(HtmlServer.serializeState(hydrated.state)).not.toContain(token)
      const missing = readCredentialProps(bootstrap, { querySelector: () => null })
      expect(missing.token).toBeUndefined()
    }).pipe(Effect.scoped, Effect.runPromise),
)

it('rejects unsupported credential paths and token material in the public site key', () => {
  expect(() =>
    makeCredentialProps('https://example.test/listening?token=fixture', metadata),
  ).toThrow('Invalid credential URL')
  expect(() => makeCredentialProps(rawUrl, metadata, token)).toThrow(
    'Credential metadata contains private material',
  )
  const safe = makeCredentialProps(rawUrl, metadata)
  expect(() => serializeCredentialBootstrap({ ...safe, turnstileSiteKey: token })).toThrow(
    'Invalid credential bootstrap',
  )
})
