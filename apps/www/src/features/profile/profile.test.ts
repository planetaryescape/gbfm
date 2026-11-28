import { HtmlServer } from '@effect/ui/html'
import { assert, it } from '@effect/vitest'
import { PublicProfileResponse } from '@gbfm/api/profile'
import { Effect } from 'effect'

import { ProfilePage } from './index'

const profile = PublicProfileResponse.make({
  id: 'host',
  name: 'Host',
  username: 'host',
  image: null,
  bio: 'Independent radio.',
  createdAt: '2026-11-01',
  socialLinks: [{ platform: 'bandcamp', url: 'https://host.bandcamp.com', position: 0 }],
  content: {
    mixes: [
      {
        id: 'mix-1',
        title: 'Private Mix',
        slug: 'private',
        thumbnailUrl: null,
        type: 'mix',
        showId: null,
        draft: true,
      },
    ],
    shows: [{ id: 'show-1', title: 'Night Radio', slug: 'night-radio', thumbnailUrl: null }],
    editorials: [
      {
        id: 'post-1',
        title: 'Listening Notes',
        slug: 'notes',
        thumbnailUrl: null,
        description: '',
        createdAt: '2026-11-01',
      },
    ],
    tweets: [{ id: 'tweet-1', title: null, slug: 'first-thought', createdAt: '2026-11-01' }],
  },
})

it.effect('keeps all profile content families, author-visible draft labels and social links', () =>
  Effect.gen(function* () {
    const result = yield* HtmlServer.renderToHtml(ProfilePage, { profile })

    for (const href of [
      '/mixes/private',
      '/shows/night-radio',
      '/editorial/notes',
      '/tweet/first-thought',
    ]) {
      assert.include(result.html, `href="${href}"`)
    }

    assert.include(result.html, '@host')
    assert.include(result.html, 'Private Mix')
    assert.include(result.html, 'Draft')
    assert.include(result.html, 'first-thought')
    assert.include(result.html, 'href="https://host.bandcamp.com"')
    assert.include(result.html, 'noopener noreferrer')
  }),
)

it.effect('distinguishes an empty public profile from a loading state', () =>
  Effect.gen(function* () {
    const result = yield* HtmlServer.renderToHtml(ProfilePage, {
      profile: { ...profile, content: { mixes: [], shows: [], editorials: [], tweets: [] } },
    })

    assert.include(result.html, 'No public content yet.')
    assert.notInclude(result.html, 'Loading')
  }),
)
