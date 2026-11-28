import { RichContentDocument } from '@gbfm/rich-content/schema'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { ContentItem } from '../domain/content-item'
import { neighbours } from '../features/reader/fixtures.test-support'
import { pageFixture } from '../server/page-fixture.test-support'
import { PageQueryError } from './page-query'
import { failedReaderPushReturn, retainedSpotlightDocument } from './routed-application'
import { readerDocument } from './routed-reader-lifetime.test-support'

const identity = { known: true, principalId: null, epoch: 1 }

const transport = new PageQueryError({
  reason: 'transport',
  status: 0,
  requestId: null,
  location: null,
})

const source = { ...readerDocument('/tweet/b'), neighbours }

const target = new URL('/tweet/c', source.url)

describe('retained navigation boundaries', () => {
  it('returns only a validated public neighbour after a failed push', () => {
    expect(failedReaderPushReturn(source, target, identity, 'push', transport)?.href).toBe(
      source.url,
    )
  })

  it.each(['initial', 'replace', 'pop'] as const)('never rolls back a %s navigation', (action) => {
    expect(failedReaderPushReturn(source, target, identity, action, transport)).toBeUndefined()
  })

  it.each(['document', 'identity', 'origin', 'redirect'] as const)(
    'does not conceal a %s failure',
    (reason) => {
      const error = new PageQueryError({ reason, status: 404, requestId: null, location: null })
      expect(failedReaderPushReturn(source, target, identity, 'push', error)).toBeUndefined()
    },
  )

  it.each(['/tweet/latest', '/tweets', '/tweet/unrelated', '/about', '/tweet/b'])(
    'does not roll back an ineligible target %s',
    (path) => {
      expect(
        failedReaderPushReturn(source, new URL(path, source.url), identity, 'push', transport),
      ).toBeUndefined()
    },
  )

  it('rejects cross-origin, unresolved, signed-in, missing and draft sources', () => {
    expect(
      failedReaderPushReturn(
        source,
        new URL('https://foreign.test/tweet/c'),
        identity,
        'push',
        transport,
      ),
    ).toBeUndefined()
    expect(
      failedReaderPushReturn(source, target, { ...identity, known: false }, 'push', transport),
    ).toBeUndefined()
    expect(
      failedReaderPushReturn(
        source,
        target,
        { ...identity, principalId: 'another' },
        'push',
        transport,
      ),
    ).toBeUndefined()
    expect(failedReaderPushReturn(undefined, target, identity, 'push', transport)).toBeUndefined()
    expect(
      failedReaderPushReturn({ ...source, status: 404 }, target, identity, 'push', transport),
    ).toBeUndefined()
    expect(
      failedReaderPushReturn(
        {
          ...source,
          tweet: source.tweet
            ? { ...source.tweet, post: { ...source.tweet.post, draft: true } }
            : null,
        },
        target,
        identity,
        'push',
        transport,
      ),
    ).toBeUndefined()
  })

  const spotlight = {
    ...pageFixture('/editorial/retained?theme=dark&at=1.1').flags,
    items: [
      ContentItem.make({
        id: 'retained',
        slug: 'retained',
        title: 'Retained',
        description: null,
        imageUrl: null,
        href: '/editorial/retained',
        meta: null,
        content: '',
        draft: false,
        audioUrl: null,
        audioType: null,
        show: null,
        creators: [],
        tags: [],
        streamingLinks: [],
        richContent: Schema.decodeUnknownSync(RichContentDocument)({
          version: 1,
          layout: 'spotlight',
          blocks: [],
        }),
      }),
    ],
  }

  it('retains only a public same-path Spotlight position with unchanged unrelated queries', () => {
    expect(
      retainedSpotlightDocument(
        spotlight,
        new URL('/editorial/retained?theme=dark&at=1.2', spotlight.url),
        identity,
      ),
    ).toBe(spotlight)
  })

  it.each(['/editorial/other?theme=dark', '/editorial/retained?theme=light', '/about?theme=dark'])(
    'does not retain Spotlight across %s',
    (path) => {
      expect(
        retainedSpotlightDocument(spotlight, new URL(path, spotlight.url), identity),
      ).toBeUndefined()
    },
  )

  it('rejects foreign origins, unresolved principals and non-public Spotlight documents', () => {
    const next = new URL(spotlight.url)
    expect(
      retainedSpotlightDocument(
        spotlight,
        new URL('https://foreign.test/editorial/retained?theme=dark'),
        identity,
      ),
    ).toBeUndefined()
    expect(
      retainedSpotlightDocument(spotlight, next, { ...identity, known: false }),
    ).toBeUndefined()
    expect(
      retainedSpotlightDocument(spotlight, next, { ...identity, principalId: 'another' }),
    ).toBeUndefined()
    expect(retainedSpotlightDocument({ ...spotlight, status: 503 }, next, identity)).toBeUndefined()
    expect(
      retainedSpotlightDocument(
        { ...spotlight, items: spotlight.items.map((item) => ({ ...item, draft: true })) },
        next,
        identity,
      ),
    ).toBeUndefined()
  })
})
