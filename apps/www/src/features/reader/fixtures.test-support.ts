import { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { MicroPostScreenResponse } from '@gbfm/api/post'
import { Schema } from 'effect'

import type { ReaderPageProps } from './contracts'

export const neighbours = Schema.decodeUnknownSync(MicroPostNeighboursResponse)({
  newer: 'c',
  older: 'a',
  olderUnread: 'a',
  newerUnread: 'c',
  seen: false,
  unreadCount: 2,
  timeline: [{ month: '2024-04', total: 3, unread: 3, newestSlug: 'c' }],
})

export const screen = (slug: string) => {
  const post = {
    id: slug,
    slug,
    title: `Tweet ${slug}`,
    description: null,
    thumbnailUrl: null,
    content: 'Readable **writing** with [a link](https://example.com).',
    compiledContent: '',
    draft: false,
    tags: ['music'],
    type: 'micro',
    musicEntityType: null,
    musicEntityId: null,
    parentPostId: null,
    rootPostId: null,
    depth: 0,
    quotedPostId: null,
    createdAt: '2024-04-01T00:00:00Z',
    updatedAt: '2024-04-01T00:00:00Z',
    music: null,
    creators: [{ id: 'author', name: 'Author', username: 'author', image: null }],
    replyCount: 0,
  }

  return Schema.decodeUnknownSync(MicroPostScreenResponse)({
    post,
    root: post,
    replies: [],
    quote: null,
  })
}

export const props = (slug = 'b', navigationId = 0): ReaderPageProps => ({
  url: new URL(`https://goosebumps.fm/tweet/${slug}`),
  principal: null,
  screen: screen(slug),
  neighbours,
  posts: [],
  renderedAt: 1711929600000,
  failure: null,
  navigationId,
})
