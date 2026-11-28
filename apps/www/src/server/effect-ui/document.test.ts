import { runInNewContext } from 'node:vm'

import { Html, HtmlServer } from '@effect/ui/html'
import { makeStaticSiteMetadata, SiteMetadata } from '@gbfm/site-metadata'
import { dark, light } from '@gbfm/theme'
import { Effect, Schema } from 'effect'
import { expect, test } from 'vitest'

import { siteHead } from '../../app/head'
import { pageFixture } from '../page-fixture.test-support'
import { preparePageResponse } from '../prepare-page-response'
import { renderDocument } from './document'
import type { DocumentAssets } from './types'

const assets: DocumentAssets = {
  entryScript: '/assets/native-document.js',
  stylesheets: ['/assets/native-document.css'],
  modulePreloads: ['/assets/native-shared.js'],
}

const Fixture = Html.component({
  name: 'NativeDocumentFixture',
  props: Schema.Struct({ metadata: SiteMetadata }),
  model: Schema.Struct({ metadata: SiteMetadata }),
  message: Schema.Never,
}).make({
  init: ({ props }) => props,
  update: ($) => $.model,
  head: ({ model }) => siteHead(model.metadata),
  view: (h) => h.main('Native document fixture'),
})

const documentHtml = async (
  metadata = makeStaticSiteMetadata('Fixture', 'Fixture description', '/about'),
) => {
  const rendered = await Effect.runPromise(HtmlServer.renderToHtml(Fixture, { metadata }))

  return renderDocument(
    {
      ...rendered,
      serializedProps: HtmlServer.serializeState({ metadata }),
      extraHead: '',
    },
    assets,
  )
}

const initialize = (
  html: string,
  theme: string,
  systemDark: boolean,
  thumbnailUrl: string | null = 'https://cdn.goosebumps.fm/art.png',
) => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]

  if (!script) throw new Error('Missing early initialization')

  const classes: Array<string> = []
  const properties = new Map<string, string>()
  const dataset: Record<string, string> = {}
  const metadata = new Map<string, string>()
  const reads: Array<string> = []

  runInNewContext(script, {
    URL,
    location: { origin: 'https://preview.example' },
    localStorage: {
      getItem: (key: string) => {
        reads.push(key)

        if (theme === 'blocked') throw new Error('Storage blocked')

        return key === 'vite-ui-theme'
          ? theme
          : JSON.stringify({
              currentIndex: 1,
              tracks: [{ thumbnailUrl: 'https://example.com/wrong.png' }, { thumbnailUrl }],
            })
      },
    },
    matchMedia: (query: string) => {
      expect(query).toBe('(prefers-color-scheme: dark)')

      return { matches: systemDark }
    },
    document: {
      querySelector: (selector: string) => {
        expect(selector).toBe('meta[name="theme-color"]')

        return { setAttribute: (name: string, value: string) => metadata.set(name, value) }
      },
      documentElement: {
        dataset,
        classList: { add: (value: string) => classes.push(value) },
        style: { setProperty: (name: string, value: string) => properties.set(name, value) },
      },
    },
  })

  return { classes, properties, dataset, metadata, reads }
}

for (const systemDark of [false, true]) {
  test.each(['light', 'dark', 'system', 'blocked'])(
    `early %s theme and queued artwork work before hydration with system dark=${systemDark}`,
    async (theme) => {
      const html = await documentHtml()

      const result = initialize(
        html,
        theme,
        systemDark,
        theme === 'light' ? null : 'https://cdn.goosebumps.fm/art.png',
      )

      let resolved = theme

      if (theme !== 'light' && theme !== 'dark') resolved = systemDark ? 'dark' : 'light'
      const background = resolved === 'dark' ? dark.backgroundHex : light.backgroundHex

      expect(result.classes).toEqual([resolved])
      expect(result.dataset.theme).toBe(resolved)
      expect(result.metadata.get('content')).toBe(background)
      expect(html).toContain(`html[data-theme='${resolved}']`)
      expect(html).toContain(`background-color: ${background}`)
      expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'))
      expect(result.dataset.queued).toBe(theme === 'blocked' ? undefined : '')

      const expectedArtwork =
        theme === 'light'
          ? 'url("https://preview.example/gb-default-v1.webp")'
          : 'url("https://cdn.goosebumps.fm/art.png?w=96&q=80&f=webp")'

      expect(result.properties.get('--queued-art')).toBe(
        theme === 'blocked' ? undefined : expectedArtwork,
      )
      expect(result.reads).toEqual(['vite-ui-theme', 'gbfm-audio-queue.json'])
    },
  )
}

test('preloads the fixed font and preserves shell assets with real native HTML', async () => {
  const html = await documentHtml()

  expect(html).toContain('<main>Native document fixture</main>')
  expect(html).toContain(
    '<link rel="preload" href="/fonts/JetBrainsMono-ExtraBold-latin.woff2" as="font" type="font/woff2" crossorigin>',
  )
  expect(html).toContain('href="/fav.png"')
  expect(html).toContain(`rel="stylesheet" href="${assets.stylesheets[0]}"`)
  expect(html).toContain(`rel="modulepreload" href="${assets.modulePreloads[0]}"`)
  expect(html).toContain(`type="module" src="${assets.entryScript}"`)
})

test.each([
  'https://cdn.goosebumps.fm/user-content/private/draft/cover.webp',
  'https://media.example.test/user-content/private/draft/cover.webp',
  'https://cdn.goosebumps.fm/mixes/private/draft/cover.webp',
  'http://media.example.test/mixes/private/draft/cover.webp',
  '/mixes/private/draft/cover.webp',
  'https://media.example.test/%6dixes/private/draft/cover.webp',
])(
  'does not expose queued private cover %s as a fetchable CSS image before credentials',
  async (url) => {
    const result = initialize(await documentHtml(), 'dark', true, url)

    expect(result.properties.get('--queued-art') ?? '').not.toContain(url)
    expect(result.properties.get('--queued-art') ?? '').not.toContain('/user-content/private/')
    expect(result.properties.get('--queued-art') ?? '').not.toContain('/mixes/private/')
    expect(result.properties.get('--queued-art')).toBe(
      'url("https://preview.example/gb-default-v1.webp")',
    )
    expect(result.dataset.queued).toBe('')
  },
)

test.each([
  'javascript:alert(1)',
  'data:image/svg+xml,<svg></svg>',
  'blob:https://preview.example/fixture',
  'ftp://media.example.test/art.png',
  'http://[invalid',
])('queued thumbnail %s cannot become an early non-HTTP image fetch', async (url) => {
  const result = initialize(await documentHtml(), 'dark', true, url)
  expect(result.properties.get('--queued-art')).toBe(
    'url("https://preview.example/gb-default-v1.webp")',
  )
  expect(result.dataset.queued).toBe('')
})

test('native homepage falls back to public metadata rather than generic page flags', async () => {
  const fixture = pageFixture('/')

  const prepared = await preparePageResponse(new Request(fixture.url), performance.now(), {
    ...fixture,
    flags: {
      ...fixture.flags,
      title: 'goosebumps.fm',
      description: 'Generic page description',
      metadata: null,
    },
  })

  const html = await documentHtml(prepared.document.metadata)

  expect(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)?.[1]).toBe(
    'goosebumps.fm (gbfm) \u2014 Independent Radio &amp; DJ Mixes',
  )
  expect(html).toContain('"alternateName":"gbfm"')
  expect(html).toContain('Discover curated music mixes, tracks, and releases.')
  expect(html).toContain('href="https://goosebumps.fm/"')
  expect(html + prepared.extraHead).not.toContain('noindex, nofollow')
  expect(html).not.toContain('Generic page description')
  expect(prepared.document.metadata.title).toBe(
    'goosebumps.fm (gbfm) \u2014 Independent Radio & DJ Mixes',
  )
})
