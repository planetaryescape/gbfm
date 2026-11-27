import { Component } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { ContentItem } from '../../domain/content-item'
import { PageDocument } from '../../domain/page'
import { MembershipProvider, membershipCommandsLayer } from '../public-actions/provider'
import { SpotifyProvider, spotifyCommandsLayer } from '../spotify/provider'
import { PublicContentPage, PublicContentPageProps } from './index'

export const PublicContentTestRoot = Html.component({
  name: 'PublicContentTestRoot',
  props: PublicContentPageProps,
  model: Schema.Struct({}),
  message: Schema.Never,
})
  .make({
    init: () => ({}),
    update: ($) => $.model,
    view: (h) =>
      MembershipProvider(h, {
        props: {
          principalId: h.props.document.principal?.id ?? null,
          principalKnown: h.props.document.principalKnown ?? true,
        },
        view: () =>
          SpotifyProvider(h, {
            props: { identity: h.props.document.principal?.id ?? 'anonymous' },
            view: () => PublicContentPage(h, { props: h.props }),
          }),
      }),
  })
  .pipe(Component.provide(membershipCommandsLayer), Component.provide(spotifyCommandsLayer))

export const publicMix = ContentItem.make({
  id: 'mix-1',
  slug: 'night-mix',
  title: 'Night Mix',
  description: 'An independent radio session.',
  imageUrl: null,
  href: '/mixes/night-mix',
  meta: '2026-11-01T10:00:00.000Z',
  content: 'Listen closely.',
  richContent: null,
  audioUrl: 'https://cdn.goosebumps.fm/night.mp3',
  audioType: 'mix',
  show: null,
  creators: [{ id: 'host-1', name: 'Host', username: 'host' }],
  tags: ['ambient'],
  streamingLinks: [{ platform: 'bandcamp', url: 'https://example.bandcamp.com/album/night' }],
})

export const publicPage = (url: string, items: ReadonlyArray<ContentItem> = [publicMix]) =>
  PageDocument.make({
    url: `https://goosebumps.fm${url}`,
    status: 200,
    principal: null,
    principalKnown: true,
    items,
    title: 'Night Mix',
    description: 'An independent radio session.',
    requestId: 'native-content-test',
    renderedAt: Date.parse('2026-11-02T10:00:00.000Z'),
    skipSeen: false,
    tweet: null,
    neighbours: null,
    dashboard: null,
    profile: null,
    shows: null,
    changelog: null,
    publicAction: null,
    metadata: null,
    failure: null,
  })
