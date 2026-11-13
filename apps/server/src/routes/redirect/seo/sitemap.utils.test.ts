import { Effect, Predicate, Stream } from 'effect'
import * as Xml from 'effect/encoding/Xml'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { buildSitemapIndexXml, buildSitemapXml, type SitemapData } from './sitemap.utils'

const siteUrl = 'https://goosebumps.fm'

const updatedAt = new Date('2024-06-15T12:30:00Z')

const emptyData: SitemapData = {
  mixes: [],
  tracks: [],
  shows: [],
  releases: [],
  labels: [],
  profiles: [],
  posts: [],
}

const staticPages = [
  ['', 'daily', '1.0'],
  ['/mixes', 'daily', '0.9'],
  ['/tweets', 'daily', '0.7'],
  ['/about', 'monthly', '0.5'],
  ['/labels', 'weekly', '0.7'],
  ['/editorial', 'daily', '0.8'],
  ['/djs', 'weekly', '0.6'],
  ['/tags', 'weekly', '0.6'],
]

const staticEntries = staticPages.map(([path, changefreq, priority]) => ({
  loc: `${siteUrl}${path}`,
  lastmod: '2026-02-01',
  changefreq,
  priority,
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-02-01T00:00:00Z'))
})

afterEach(() => vi.useRealTimers())

const parseEntries = async (xml: string, rootName: 'urlset' | 'sitemapindex') => {
  expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/)

  const [root] = await Effect.runPromise(
    Stream.make(xml).pipe(
      Stream.pipeThroughChannel(Xml.decodeString()),
      Stream.pipeThroughChannel(Xml.elements(['*'])),
      Stream.runCollect,
    ),
  )

  expect(root?.name).toBe(rootName)
  expect(root?.attributes.xmlns).toBe('http://www.sitemaps.org/schemas/sitemap/0.9')

  return (
    root?.children.flatMap((entry) => {
      if (Predicate.isString(entry)) return []
      expect(entry.name).toBe(rootName === 'urlset' ? 'url' : 'sitemap')

      return [
        Object.fromEntries(
          entry.children.flatMap((field) => {
            if (Predicate.isString(field)) return []
            expect(field.children.every(Predicate.isString)).toBe(true)

            return [[field.name, field.children.filter(Predicate.isString).join('')]]
          }),
        ),
      ]
    }) ?? []
  )
}

test('publishes canonical content URLs with their dates and crawl metadata, excluding unnamed profiles', async () => {
  const entry = (slug: string) => ({ slug, updatedAt })

  const xml = buildSitemapXml(
    {
      mixes: [entry('summer-vibes'), entry('chill-beats')],
      tracks: [entry('deep-cut')],
      shows: [entry('weekly-mix')],
      releases: [entry('debut-album')],
      labels: [entry('underground-sounds')],
      profiles: [
        { username: 'dj-cool', updatedAt },
        { username: null, updatedAt },
      ],
      posts: [
        { ...entry('my-editorial'), type: 'post' },
        { ...entry('my-tweet'), type: 'micro' },
        { ...entry('unknown-type'), type: null },
      ],
    },
    siteUrl,
  )

  const content = [
    ['/mixes/summer-vibes', 'weekly', '0.8'],
    ['/mixes/chill-beats', 'weekly', '0.8'],
    ['/tracks/deep-cut', 'weekly', '0.8'],
    ['/shows/weekly-mix', 'weekly', '0.8'],
    ['/releases/debut-album', 'monthly', '0.6'],
    ['/labels/underground-sounds', 'monthly', '0.6'],
    ['/dj-cool', 'weekly', '0.5'],
    ['/editorial/my-editorial', 'weekly', '0.7'],
    ['/tweet/my-tweet', 'weekly', '0.7'],
    ['/editorial/unknown-type', 'weekly', '0.7'],
  ].map(([path, changefreq, priority]) => ({
    loc: `${siteUrl}${path}`,
    lastmod: '2024-06-15',
    changefreq,
    priority,
  }))

  expect(await parseEntries(xml, 'urlset')).toEqual([...staticEntries, ...content])
})

test('keeps public navigation discoverable when the catalogue is empty', async () => {
  expect(await parseEntries(buildSitemapXml(emptyData, siteUrl), 'urlset')).toEqual(staticEntries)
})

test('escapes XML-sensitive content URLs without changing their decoded destinations', async () => {
  const xml = buildSitemapXml(
    {
      ...emptyData,
      tracks: [{ slug: 'r&b<live>', updatedAt }],
    },
    siteUrl,
  )

  expect(xml).toContain('<loc>https://goosebumps.fm/tracks/r&amp;b&lt;live&gt;</loc>')
  expect(await parseEntries(xml, 'urlset')).toEqual([
    ...staticEntries,
    {
      loc: `${siteUrl}/tracks/r&b<live>`,
      lastmod: '2024-06-15',
      changefreq: 'weekly',
      priority: '0.8',
    },
  ])
})

test('directs crawlers from the sitemap index to the current public sitemap', async () => {
  expect(await parseEntries(buildSitemapIndexXml(siteUrl), 'sitemapindex')).toEqual([
    { loc: `${siteUrl}/sitemap.xml`, lastmod: '2026-02-01' },
  ])
})
