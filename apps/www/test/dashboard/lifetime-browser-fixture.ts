import { Component } from '@effect/ui'
import { BrowserHost, Html } from '@effect/ui/html'
import { Effect, Layer, Schema } from 'effect'

import { type DashboardDocument, emptyDocument } from '../../src/features/dashboard/document'
import { EmailHistoryView } from '../../src/features/dashboard/email-history-view'
import { DashboardLibraryNoDeps, WriteLibrary } from '../../src/features/dashboard/library'
import { DashboardService, ReadDashboard } from '../../src/features/dashboard/service'
import { DashboardSessions } from '../../src/features/dashboard/sessions'
import { UsersView } from '../../src/features/dashboard/users-view'

const playlist = {
  id: 'playlist',
  title: 'Local playlist',
  slug: 'local-playlist',
  description: null,
  coverImageUrl: null,
  curatorId: null,
  publishedAt: null,
  createdById: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const data: DashboardDocument = {
  ...emptyDocument,
  playlists: [playlist],
  playlistTracks: ['Alpha', 'Bravo', 'Charlie'].map((title, position) => ({
    track: {
      ...playlist,
      id: title,
      title,
      slug: title,
      revision: 0,
      albumId: null,
      trackNumber: null,
      artistNames: [],
    },
    links: [],
    position,
    addedAt: playlist.createdAt,
  })),
  shows: {
    data: [
      {
        id: 'show',
        title: 'Local show',
        slug: 'local-show',
        description: null,
        content: '',
        thumbnailUrl: null,
        bannerImageUrl: null,
        tags: [],
        draft: false,
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt,
        hosts: [],
      },
    ],
    pagination: { total: 1, limit: 25, offset: 0, hasMore: false },
  },
  users: {
    users: [
      {
        id: 'user',
        name: 'Local User',
        email: 'user@example.test',
        role: 'creator',
        emailVerified: false,
        banned: false,
      },
    ],
    total: 1,
    limit: 20,
    offset: 0,
  },
}

const service = Layer.succeed(DashboardService, {
  request: ({ method = 'GET' }) => {
    if (method !== 'GET')
      document.body.dataset.writes = String(Number(document.body.dataset.writes ?? 0) + 1)

    return Effect.succeed(data)
  },
  readPlayerPreferences: Effect.die('Not part of this fixture'),
  writePlayerPreferences: () => Effect.die('Not part of this fixture'),
})

const Library = DashboardLibraryNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(ReadDashboard.layer, WriteLibrary.layer).pipe(Layer.provide(service)),
  ),
)

const Static = Html.component({
  name: 'DashboardBoundaryFixture',
  props: Schema.Struct({ section: Schema.String }),
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    h.section
      .class('admin-page')
      .children(
        h.props.section === 'users'
          ? UsersView(h, data, '/dashboard/users')
          : EmailHistoryView(
              h,
              data,
              '/dashboard/email-logs?dateFrom=2026-09-26&dateTo=2026-09-26',
              Date.UTC(2026, 10, 27),
            ),
      ),
})

const root = document.getElementById('app')

const section = new URL(location.href).searchParams.get('section') ?? 'playlists'

if (root) {
  Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        if (section === 'sessions') yield* BrowserHost.mountEffect(DashboardSessions, {}, root)
        else if (section === 'users' || section === 'dates')
          yield* BrowserHost.mountEffect(Static, { section }, root)
        else
          yield* BrowserHost.mountEffect(
            Library,
            {
              section,
              principal: { id: 'admin', name: null, username: null, role: 'admin' },
              initialDocument: data,
            },
            root,
          )
        document.body.dataset.ready = 'true'

        return yield* Effect.never
      }),
    ),
  )
}
