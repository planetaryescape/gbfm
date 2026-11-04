import { MicroPostScreenResponse } from '@gbfm/api/post'
import { Effect, Schema } from 'effect'
import * as Server from 'foldkit/experimental/server'
import { expect, test } from 'vitest'

import { applicationConfig } from '../config'
import type { Flags } from '../model'

const post = {
  id: 'ssr-fixture',
  slug: 'ssr-fixture',
  title: 'SSR fixture',
  description: null,
  thumbnailUrl: null,
  content: 'Fixture content',
  draft: false,
  tags: [],
  type: 'micro',
  musicEntityType: null,
  musicEntityId: null,
  parentPostId: null,
  rootPostId: null,
  depth: 0,
  quotedPostId: null,
  createdAt: '2024-04-01T00:00:00Z',
  updatedAt: '2024-04-01T00:00:00Z',
  compiledContent: 'Fixture content',
  music: {
    entity: {
      id: 'fixture-track',
      type: 'track',
      title: 'Fixture track',
      artistNames: [],
      coverImageUrl: null,
    },
    links: [{ platform: 'spotify', url: 'https://open.spotify.com/track/E2ERootTrack' }],
  },
}

const flags: Flags = {
  url: 'https://fixture.test/tweet/ssr-fixture',
  status: 200,
  principal: null,
  items: [],
  title: 'SSR fixture',
  description: '',
  requestId: 'ssr-fixture',
  renderedAt: 0,
  skipSeen: false,
  tweet: Schema.decodeUnknownSync(MicroPostScreenResponse)({
    post,
    root: post,
    replies: [],
    quote: null,
  }),
  neighbours: null,
  dashboard: null,
  profile: null,
  shows: null,
  changelog: null,
  publicAction: null,
  metadata: null,
  failure: null,
}

test('tweet SSR accepts the framework URL argument without treating it as retained Spotify state', async () => {
  const rendered = await Effect.runPromise(
    Server.renderToString(applicationConfig, { flags, url: flags.url, buildId: 'ssr-fixture' }),
  )

  expect(rendered.html).toContain('Fixture content')
  expect(rendered.html).toContain('Connect Spotify')
  expect(rendered.html).toContain('Fixture track')
})
