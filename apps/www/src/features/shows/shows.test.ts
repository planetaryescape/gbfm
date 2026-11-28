import { HtmlServer } from '@effect/ui/html'
import { assert, it } from '@effect/vitest'
import { GetShowEpisodesResponse } from '@gbfm/api/shows'
import { Effect } from 'effect'

import { ShowsDocument } from '../../domain/shows'
import { publicPage, PublicContentTestRoot } from '../content/fixtures'
import { episodeTrack } from './episodes'

const episodes = GetShowEpisodesResponse.make({
  data: [
    {
      id: 'episode-1',
      title: 'Night Transmission',
      description: 'A new episode.',
      thumbnailUrl: null,
      bannerImageUrl: null,
      slug: 'night-transmission',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      draft: false,
      tags: [],
      content: '',
      type: 'mix',
      url: 'https://cdn.goosebumps.fm/episode.mp3',
      showId: 'show-1',
      episodeNumber: 12,
      playCount: 2,
      creators: [{ id: 'creator', name: 'Creator', username: null }],
      artists: [{ id: 'artist', name: 'Artist', username: 'artist' }],
    },
  ],
  pagination: { total: 12, limit: 100, offset: 0, hasMore: false },
})

const shows = ShowsDocument.make({
  shows: [
    {
      id: 'show-1',
      title: 'Night Radio',
      description: 'Independent radio.',
      thumbnailUrl: null,
      bannerImageUrl: null,
      slug: 'night-radio',
      content: '',
      draft: false,
      tags: [],
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
      hosts: [{ id: 'host', name: 'Host', username: 'host' }],
    },
  ],
  selectedSlug: 'night-radio',
  episodes,
})

it.effect(
  'server-renders URL selection, host credits, artwork fallbacks and numbered episodes',
  () =>
    Effect.gen(function* () {
      const result = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
        document: { ...publicPage('/shows/night-radio', []), shows },
      })

      assert.include(result.html, 'Night Radio')
      assert.include(result.html, 'aria-current="page"')
      assert.include(result.html, 'href="/shows/night-radio"')
      assert.include(result.html, 'href="/host"')
      assert.include(result.html, 'Night Transmission')
      assert.include(result.html, 'href="/profile/artist"')
      assert.include(result.html, 'href="/mixes/night-transmission"')
      assert.include(result.html, 'Play episode 12: Night Transmission')
      assert.include(result.html, '012')
      assert.include(result.html, '2 plays')
      assert.include(result.html, 'Play all')
      assert.include(result.html, 'Queue all')
      assert.include(result.html, '/gb-default-v1.webp')
    }),
)

it.effect('does not mistake a failed episode read for an empty show', () =>
  Effect.gen(function* () {
    const failed = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: { ...publicPage('/shows/night-radio', []), shows: { ...shows, episodes: null } },
    })

    assert.include(failed.html, 'Episodes are unavailable right now.')
    assert.notInclude(failed.html, 'No episodes yet.')

    const empty = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: {
        ...publicPage('/shows/night-radio', []),
        shows: { ...shows, episodes: { ...episodes, data: [] } },
      },
    })

    assert.include(empty.html, 'No episodes yet.')
    assert.notInclude(empty.html, 'Episodes are unavailable right now.')
  }),
)

it('uses the existing artist-over-creator playback credit rule', () => {
  const episode = episodes.data[0]

  if (!episode) throw new Error('Missing episode fixture')
  assert.deepStrictEqual(episodeTrack(episode).creators, episode.artists)
  assert.deepStrictEqual(episodeTrack({ ...episode, artists: [] }).creators, episode.creators)
})
