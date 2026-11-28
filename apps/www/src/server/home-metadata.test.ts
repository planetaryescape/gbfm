import { Predicate, Schema } from 'effect'
import { expect, test } from 'vitest'

import { PageDocument } from '../domain/page'
import { renderNativePage } from '../entry.effect.server'
import { pageFixture } from './page-fixture.test-support'

test('native homepage JSON navigation supplies public metadata when generic flags have none', async () => {
  const fixture = pageFixture('/')
  const request = new Request('https://preview.example.test/?__data=1')

  const result = await renderNativePage(request, true, performance.now(), {
    ...fixture,
    flags: {
      ...fixture.flags,
      title: 'goosebumps.fm',
      metadata: null,
    },
  })

  if (!Predicate.isTagged(result, 'Responded'))
    throw new Error('JSON navigation must not render the application')

  expect(result.response.status).toBe(200)
  expect(result.response.headers.get('content-type')).toBe('application/json')
  expect(result.response.headers.get('cache-control')).toBe('private, no-store')
  const document = Schema.decodeUnknownSync(PageDocument)(await result.response.json())
  expect(document.metadata).toMatchObject({
    title: 'goosebumps.fm (gbfm) \u2014 Independent Radio & DJ Mixes',
    description: expect.stringContaining('Discover curated music mixes, tracks, and releases.'),
    canonicalUrl: 'https://goosebumps.fm/',
  })
})
