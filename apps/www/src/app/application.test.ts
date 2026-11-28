import { MessageLog } from '@effect/ui'
import { HtmlServer } from '@effect/ui/html'
import { expect, it } from '@effect/vitest'
import { getStaticSiteMetadata } from '@gbfm/site-metadata'
import { Effect, Predicate, Schema } from 'effect'

import { Application } from './application'
import { HydrationState } from './hydration'
import { AppProps, AppPropsJson, serializeAppProps } from './props'

const aboutProps = () => {
  const metadata = getStaticSiteMetadata('/about')

  if (!metadata) throw new Error('Missing About metadata fixture')

  return AppProps.make({ url: new URL('https://goosebumps.fm/about'), metadata })
}

it.effect(
  'server-renders the public About content and native metadata without browser services',
  () =>
    Effect.gen(function* () {
      const entries: Array<MessageLog.Entry> = []

      const rendered = yield* HtmlServer.renderToHtml(Application, aboutProps()).pipe(
        Effect.provideService(MessageLog.MessageLog, {
          enabled: true,
          record: (entry) => entries.push(entry),
        }),
      )

      expect(entries.filter((entry) => Predicate.isTagged(entry, 'Failed'))).toEqual([])
      expect(rendered.html).toContain('About')
      expect(rendered.html).toContain('Mixes via RSS')
      expect(rendered.html).toContain('Privacy policy')
      expect(rendered.head).toContain('https://goosebumps.fm/about')
      expect(rendered.head).toContain('application/ld+json')
      expect(rendered.htmlAttributes).toContain('lang="en"')
      expect(Object.keys(rendered.state).some((key) => key.includes('ThemeButton'))).toBe(true)
    }),
)

it('preserves URL props through the public JSON codec without allowing script termination', () => {
  const props = aboutProps()

  const serialized = serializeAppProps({
    ...props,
    metadata: { ...props.metadata, title: '</script><script>untrusted()</script>' },
  })

  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(AppPropsJson))(serialized)

  expect(serialized).not.toContain('<')
  expect(decoded.url.href).toBe(props.url.href)
  expect(decoded.metadata.title).toBe('</script><script>untrusted()</script>')
})

it('rejects malformed reserved hydration fields before the native runtime reads them', () => {
  expect(() => Schema.decodeUnknownSync(HydrationState)({ '~deferred': 'not-an-array' })).toThrow()
  expect(() => Schema.decodeUnknownSync(HydrationState)({ '~static': 'not-a-boolean' })).toThrow()
})
