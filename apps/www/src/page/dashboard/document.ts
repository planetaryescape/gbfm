import {
  AdminOverviewResponse,
  AdminTelemetryResponse,
  FeaturedMixSettings,
  NewsletterSubscribersResponse,
} from '@gbfm/api/admin'
import { GetAudioByTypeResponse } from '@gbfm/api/audio'
import {
  EmailLogsResponse,
  MixAnnouncementOptions,
  SendMixNotificationResponse,
} from '@gbfm/api/email'
import { GetFavoritesResponse } from '@gbfm/api/favorites'
import { McpConnectionsResponse } from '@gbfm/api/mcp-connections'
import {
  ImportSpotifyPlaylistResponse,
  PlaylistListResponse,
  PlaylistTrackEntry,
  SyncPlaylistLinksResponse,
} from '@gbfm/api/music'
import { GetMusicRemindersResponse } from '@gbfm/api/music-reminders'
import { GetPostsResponse } from '@gbfm/api/post'
import { SearchResults } from '@gbfm/api/search'
import { GetAllShowsResponse } from '@gbfm/api/shows'
import { UserProfileResponse } from '@gbfm/api/user'
import { Data, Effect, Schema } from 'effect'

import { highlightRows } from './page/admin'
import { parseCatalogDocument } from './page/catalog'
import { AdminUsers } from './page/users'

export const Row = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  detail: Schema.String,
  href: Schema.NullOr(Schema.String),
  actionId: Schema.NullOr(Schema.String),
  thumbnailUrl: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.String),
})

export const Pagination = Schema.Struct({
  total: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
  hasMore: Schema.Boolean,
})

export const DashboardDocument = Schema.Struct({
  rows: Schema.Array(Row),
  pagination: Schema.optional(Pagination),
  fields: Schema.Record(Schema.String, Schema.String),
  toggles: Schema.Record(Schema.String, Schema.Boolean),
  telemetry: Schema.optional(AdminTelemetryResponse),
  users: Schema.optional(AdminUsers),
  shows: Schema.optional(GetAllShowsResponse),
  playlists: Schema.optional(PlaylistListResponse),
  playlistTracks: Schema.optional(Schema.Array(PlaylistTrackEntry)),
  playlistImport: Schema.optional(ImportSpotifyPlaylistResponse),
  playlistSync: Schema.optional(SyncPlaylistLinksResponse),
  subscribers: Schema.optional(NewsletterSubscribersResponse.fields.subscribers),
  emailLogs: Schema.optional(EmailLogsResponse),
  announcementOptions: Schema.optional(MixAnnouncementOptions),
  emailSend: Schema.optional(SendMixNotificationResponse),
  connections: Schema.optional(McpConnectionsResponse.fields.connections),
})

export type DashboardDocument = typeof DashboardDocument.Type

export const emptyDocument: DashboardDocument = { rows: [], fields: {}, toggles: {} }

const rowsDocument = (rows: ReadonlyArray<typeof Row.Type>): DashboardDocument => ({
  ...emptyDocument,
  rows,
})

const EmailPreferences = Schema.Struct({
  mixReleaseEnabled: Schema.Boolean,
  promotionalEnabled: Schema.Boolean,
  systemEnabled: Schema.Boolean,
  globalUnsubscribe: Schema.Boolean,
})

/** Each endpoint is decoded before its payload enters the dashboard state machine. */
export const parseDashboardDocument = (
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- HTTP response parsing boundary; each case decodes its endpoint contract.
  input: unknown,
): Effect.Effect<DashboardDocument, Schema.SchemaError | UnsupportedDashboardEndpoint> => {
  const pathname = new URL(path, 'http://localhost').pathname

  if (pathname === '/api/user/mcp-connections')
    return Schema.decodeUnknownEffect(McpConnectionsResponse)(input).pipe(
      Effect.map(({ connections }) => ({ ...emptyDocument, connections })),
    )

  if (/^\/api\/music\/playlists\/[^/]+\/tracks$/.test(pathname))
    return Schema.decodeUnknownEffect(Schema.Array(PlaylistTrackEntry))(input).pipe(
      Effect.map((playlistTracks) => ({ ...emptyDocument, playlistTracks })),
    )

  if (pathname === '/api/music/playlists/import/spotify')
    return Schema.decodeUnknownEffect(ImportSpotifyPlaylistResponse)(input).pipe(
      Effect.map((playlistImport) => ({ ...emptyDocument, playlistImport })),
    )

  if (/^\/api\/music\/playlists\/[^/]+\/sync-links$/.test(pathname))
    return Schema.decodeUnknownEffect(SyncPlaylistLinksResponse)(input).pipe(
      Effect.map((playlistSync) => ({ ...emptyDocument, playlistSync })),
    )
  const catalog = parseCatalogDocument(pathname, input)

  if (catalog) return catalog

  switch (pathname) {
    case '/api/email/mix-announcement-options':
      return Schema.decodeUnknownEffect(MixAnnouncementOptions)(input).pipe(
        Effect.map((announcementOptions) => ({ ...emptyDocument, announcementOptions })),
      )
    case '/api/email/send-mix-notification':
      return Schema.decodeUnknownEffect(SendMixNotificationResponse)(input).pipe(
        Effect.map((emailSend) => ({ ...emptyDocument, emailSend })),
      )
    case '/api/admin/featured-mix':
      return Schema.decodeUnknownEffect(FeaturedMixSettings)(input).pipe(
        Effect.map(({ mixId, unavailableTitle, mixes }) => ({
          ...rowsDocument(mixes.map((mix) => ({ ...mix, detail: '', href: null, actionId: null }))),
          fields: {
            mixId: mixId ?? '',
            savedMixId: mixId ?? '',
            unavailableTitle: unavailableTitle ?? '',
          },
        })),
      )
    case '/auth/admin/list-users':
      return Schema.decodeUnknownEffect(AdminUsers)(input).pipe(
        Effect.map((users) => ({
          ...emptyDocument,
          users,
          fields: {
            search: new URL(path, 'http://localhost').searchParams.get('searchValue') ?? '',
            offset: String(
              users.offset ?? new URL(path, 'http://localhost').searchParams.get('offset') ?? 0,
            ),
          },
        })),
      )
    case '/api/content/posts/manage':
      return Schema.decodeUnknownEffect(GetPostsResponse)(input).pipe(
        Effect.map(({ data, pagination }) => ({
          ...rowsDocument(
            data.map((post) => ({
              id: post.id,
              title: post.title ?? post.content?.slice(0, 80) ?? post.slug,
              detail: post.draft ? 'Draft' : 'Published',
              status: post.draft ? 'Draft' : 'Published',
              href: `/new/${post.type === 'micro' ? 'tweet' : 'editorial'}?edit=${encodeURIComponent(post.slug)}`,
              actionId: post.id,
            })),
          ),
          pagination,
        })),
      )
    case '/api/search':
      return Schema.decodeUnknownEffect(SearchResults)(input).pipe(
        Effect.map(({ shows, audio, posts }) =>
          rowsDocument([
            ...shows.map((item) => ({
              id: item.id,
              title: item.title ?? item.slug,
              detail: 'Show',
              href: `/shows/${encodeURIComponent(item.slug)}`,
              actionId: null,
            })),
            ...audio.map((item) => ({
              id: item.id,
              title: item.title ?? item.slug,
              detail: item.type,
              href: `/mixes/${encodeURIComponent(item.slug)}`,
              actionId: null,
            })),
            ...posts.map((item) => ({
              id: item.id,
              title: item.title ?? item.slug,
              detail: item.type,
              href: `/${item.type === 'micro' ? 'tweet' : 'editorial'}/${encodeURIComponent(item.slug)}`,
              actionId: null,
            })),
          ]),
        ),
      )
    case '/api/user/profile':
      return Schema.decodeUnknownEffect(UserProfileResponse)(input).pipe(
        Effect.map(({ username, email, bio }) => ({
          ...emptyDocument,
          fields: { username: username ?? '', email, bio: bio ?? '' },
        })),
      )
    case '/api/user/email-preferences':
      return Schema.decodeUnknownEffect(EmailPreferences)(input).pipe(
        Effect.map((toggles) => ({ ...emptyDocument, toggles })),
      )
    case '/api/favorites':
      return Schema.decodeUnknownEffect(GetFavoritesResponse)(input).pipe(
        Effect.map(({ favorites }) =>
          rowsDocument(
            favorites.map((favorite) => {
              const content = favorite.audio ?? favorite.show

              return {
                id: favorite.id,
                title: content?.title ?? 'Unavailable content',
                detail: favorite.audio?.type ?? 'show',
                thumbnailUrl: content?.thumbnailUrl ?? null,
                href: content
                  ? `/${favorite.audio ? 'mixes' : 'shows'}/${encodeURIComponent(content.slug)}`
                  : null,
                actionId: favorite.audioId ?? (favorite.showId ? `show/${favorite.showId}` : null),
              }
            }),
          ),
        ),
      )
    case '/api/music-reminders':
      return Schema.decodeUnknownEffect(GetMusicRemindersResponse)(input).pipe(
        Effect.map(({ reminders }) =>
          rowsDocument(
            reminders.map((item) => ({
              id: item.id,
              title: item.musicTitle,
              detail: item.artistName,
              thumbnailUrl: item.albumCoverUrl,
              href: item.musicUrl,
              actionId: item.id,
            })),
          ),
        ),
      )
    case '/api/shows/manage':
      return Schema.decodeUnknownEffect(GetAllShowsResponse)(input).pipe(
        Effect.map((shows) => ({ ...emptyDocument, shows })),
      )
    case '/api/shows':
      return Schema.decodeUnknownEffect(GetAllShowsResponse)(input).pipe(
        Effect.map(({ data }) =>
          rowsDocument(
            data.map((item) => ({
              id: item.id,
              title: item.title,
              detail: item.draft ? 'Draft' : 'Published',
              href: `/shows/${encodeURIComponent(item.slug)}`,
              actionId: null,
            })),
          ),
        ),
      )
    case '/api/content/audio/mix/manage':
      return Schema.decodeUnknownEffect(GetAudioByTypeResponse)(input).pipe(
        Effect.map(({ data, pagination }) => ({
          ...rowsDocument(
            data.map((item) => ({
              id: item.id,
              title: item.title,
              detail: item.draft ? 'Draft' : 'Published',
              status: item.draft ? 'Draft' : 'Published',
              href: `/new/mix?edit=${encodeURIComponent(item.slug)}`,
              actionId: null,
            })),
          ),
          pagination,
        })),
      )
    case '/api/email/logs':
      return Schema.decodeUnknownEffect(EmailLogsResponse)(input).pipe(
        Effect.map((emailLogs) => ({
          ...emptyDocument,
          emailLogs,
          fields: Object.fromEntries(new URL(path, 'http://localhost').searchParams),
        })),
      )
    case '/api/admin/newsletter-subscribers':
      return Schema.decodeUnknownEffect(NewsletterSubscribersResponse)(input).pipe(
        Effect.map(({ subscribers }) => ({ ...emptyDocument, subscribers })),
      )
    case '/api/admin/overview':
      return Schema.decodeUnknownEffect(AdminOverviewResponse)(input).pipe(
        Effect.map(({ highlights }) => rowsDocument(highlightRows(highlights))),
      )
    case '/api/admin/telemetry':
      return Schema.decodeUnknownEffect(AdminTelemetryResponse)(input).pipe(
        Effect.map((telemetry) => ({ ...emptyDocument, telemetry })),
      )
    default:
      return Effect.fail(new UnsupportedDashboardEndpoint())
  }
}

class UnsupportedDashboardEndpoint extends Data.TaggedError('UnsupportedDashboardEndpoint') {}
