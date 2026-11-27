import { makeStaticSiteMetadata } from '@gbfm/site-metadata'
import { expect, test } from 'vitest'

import { ContentItem } from '../domain/content-item'
import { pageFixture } from './page-fixture.test-support'
import { preparePageResponse } from './prepare-page-response'

test('prepares a native page document with all cookies and private response headers', async () => {
  const page = pageFixture()
  const responseHeaders = new Headers()
  responseHeaders.append('set-cookie', 'api-first=1; HttpOnly')
  responseHeaders.append('set-cookie', 'api-second=2; HttpOnly')

  const prepared = await preparePageResponse(new Request(page.url), performance.now(), {
    ...page,
    identity: { ...page.identity, cookies: ['identity=1; HttpOnly'] },
    response: new Response(null, { headers: responseHeaders }),
    neighbourResponse: new Response(null, { headers: { 'set-cookie': 'neighbour=1; HttpOnly' } }),
  })

  expect(prepared.headers.getSetCookie()).toEqual([
    'identity=1; HttpOnly',
    'api-first=1; HttpOnly',
    'api-second=2; HttpOnly',
    'neighbour=1; HttpOnly',
  ])
  expect(prepared.headers.get('cache-control')).toBe('private, no-store')
  expect(prepared.headers.get('x-request-id')).toBe('prepared-fixture')
  expect(prepared.headers.get('server-timing')).toMatch(/^foldkit;dur=\d+\.\d$/)
  expect(prepared.status).toBe(200)
  expect(prepared.document.title).toBe('Fixture page')
  expect(prepared.extraHead).toBe('')
  expect(prepared.unmanagedHead).toBe('')
})

test('normalizes canonical metadata without duplicating the native component head', async () => {
  const page = pageFixture('/editorial/fixture')

  const metadata = {
    ...makeStaticSiteMetadata('Fixture metadata', 'Metadata description', '/editorial/fixture'),
    canonicalUrl: 'https://preview.example.test/editorial/fixture?preview=1',
  }

  const prepared = await preparePageResponse(new Request(page.url), performance.now(), {
    ...page,
    flags: { ...page.flags, metadata },
  })

  expect(prepared.document.metadata.canonicalUrl).toBe('https://goosebumps.fm/editorial/fixture')
  expect(prepared.document.metadata.title).toBe('Fixture metadata')
  expect(prepared.extraHead).not.toContain('og:')
  expect(prepared.extraHead).not.toContain('application/ld+json')
})

test('drafts never reuse public metadata and retain robots headers and markup', async () => {
  const page = pageFixture('/editorial/draft')

  const item = ContentItem.make({
    id: 'draft-fixture',
    slug: 'draft',
    title: 'Draft page',
    description: null,
    imageUrl: null,
    href: '/editorial/draft',
    meta: null,
    content: '',
    richContent: null,
    audioUrl: null,
    audioType: null,
    show: null,
    creators: [],
    tags: [],
    streamingLinks: [],
    draft: true,
  })

  const prepared = await preparePageResponse(new Request(page.url), performance.now(), {
    ...page,
    flags: { ...page.flags, title: 'Draft page', items: [item] },
  })

  expect(prepared.document.metadata.title).toBe('Draft page')
  expect(prepared.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  expect(prepared.extraHead).toContain('name="robots" content="noindex, nofollow"')
  expect(prepared.unmanagedHead).toBe('')
})

test.each(['/dashboard/users', '/new/tweet', '/auth/sign-in', '/listening', '/spotify/callback'])(
  'private route %s remains excluded from indexing',
  async (path) => {
    const page = pageFixture(path)
    const prepared = await preparePageResponse(new Request(page.url), performance.now(), page)
    expect(prepared.extraHead).toContain('name="robots" content="noindex, nofollow"')
    expect(prepared.unmanagedHead).toBe('')
  },
)

test('error pages and reader entry URLs retain their no-JavaScript response contracts', async () => {
  const page = pageFixture('/tweets')

  const prepared = await preparePageResponse(new Request(page.url), performance.now(), {
    ...page,
    flags: { ...page.flags, status: 503 },
  })

  expect(prepared.status).toBe(503)
  expect(prepared.extraHead).toContain(
    '<noscript><meta http-equiv="refresh" content="0;url=/tweet/latest"></noscript>',
  )
  expect(prepared.extraHead).toContain('name="robots" content="noindex, nofollow"')
  expect(prepared.unmanagedHead).toBe(
    '<noscript><meta http-equiv="refresh" content="0;url=/tweet/latest"></noscript>',
  )
})

test('signed OAuth login continuations retain strict-origin referrer policy', async () => {
  const returnTo =
    '/connect/gbfm?client_id=fixture&scope=posts%3Aread&resource=https%3A%2F%2Ffixture.test&exp=123&sig=fixture&ba_param=client_id&ba_param=scope&ba_param=resource&ba_param=exp&ba_param=ba_param'

  const page = pageFixture(`/auth/sign-in?${new URLSearchParams({ returnTo })}`)
  const prepared = await preparePageResponse(new Request(page.url), performance.now(), page)
  expect(prepared.headers.get('referrer-policy')).toBe('strict-origin')
})
