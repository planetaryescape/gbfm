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
  AlbumListResponse,
  AlbumResponse,
  ArtistListResponse,
  ArtistResponse,
  EntityLinkListResponse,
  ImportSpotifyPlaylistResponse,
  LabelListResponse,
  LabelResponse,
  PlaylistListResponse,
  PlaylistTrackEntry,
  SyncPlaylistLinksResponse,
  TrackListResponse,
  TrackResponse,
} from '@gbfm/api/music'
import { GetMusicRemindersResponse } from '@gbfm/api/music-reminders'
import { GetPostsResponse } from '@gbfm/api/post'
import { SearchResults } from '@gbfm/api/search'
import { GetAllShowsResponse } from '@gbfm/api/shows'
import { UserProfileResponse } from '@gbfm/api/user'
import { Effect, Schema } from 'effect'

import { AdminUsers, type DashboardDocument, emptyDocument, type Row } from './document'

export class DashboardProjectionError extends Schema.TaggedError<DashboardProjectionError>()(
  'DashboardProjectionError',
  {
    message: Schema.String,
  },
) {}

const rows = (value: ReadonlyArray<typeof Row.Type>): DashboardDocument => ({
  ...emptyDocument,
  rows: value,
})

const fields = (
  value: Readonly<Record<string, string | number | null | ReadonlyArray<string>>>,
): DashboardDocument => ({
  ...emptyDocument,
  fields: Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (item === null) return [key, '']

      if (Array.isArray(item)) return [key, item.join(', ')]

      return [key, String(item)]
    }),
  ),
})

const catalogRow = (
  item: { readonly id: string; readonly slug: string; readonly publishedAt: string | null },
  title: string,
  kind: string,
): typeof Row.Type => ({
  id: item.id,
  title,
  detail: item.slug,
  status: item.publishedAt ? 'Published' : 'Draft',
  href:
    kind === 'playlist'
      ? '/dashboard/playlists'
      : `/dashboard/music-entity/${kind}/${encodeURIComponent(item.id)}`,
  actionId: null,
})

export const parseDashboardDocument = (
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This HTTP boundary decodes each endpoint schema before projection.
  input: unknown,
): Effect.Effect<DashboardDocument, Schema.SchemaError | DashboardProjectionError> => {
  const url = new URL(path, 'http://localhost')
  const pathname = url.pathname

  if (/^\/api\/music\/playlists\/[^/]+\/tracks$/.test(pathname))
    return Schema.decodeUnknownEffect(Schema.Array(PlaylistTrackEntry))(input).pipe(
      Effect.map((playlistTracks) => ({ ...emptyDocument, playlistTracks })),
    )

  if (/^\/api\/music\/playlists\/[^/]+\/sync-links$/.test(pathname))
    return Schema.decodeUnknownEffect(SyncPlaylistLinksResponse)(input).pipe(
      Effect.map((playlistSync) => ({ ...emptyDocument, playlistSync })),
    )

  if (/^\/api\/music\/(artist|album|track|label)\/[^/]+\/links$/.test(pathname))
    return Schema.decodeUnknownEffect(EntityLinkListResponse)(input).pipe(
      Effect.map((links) =>
        rows(
          links.map((link) => ({
            id: link.id,
            title: link.platform,
            detail: link.url,
            status: link.status,
            href: /^https?:\/\//.test(link.url) ? link.url : null,
            actionId: link.id,
          })),
        ),
      ),
    )
  const entity = /^\/api\/music\/(artists|albums|tracks|labels)\/[^/]+$/.exec(pathname)

  if (entity && !pathname.endsWith('/manage')) {
    switch (entity[1]) {
      case 'artists':
        return Schema.decodeUnknownEffect(ArtistResponse)(input).pipe(
          Effect.map((item) =>
            fields({
              id: item.id,
              revision: item.revision,
              name: item.name,
              slug: item.slug,
              bio: item.bio,
              imageUrl: item.imageUrl,
              genres: item.genres,
              publishedAt: item.publishedAt,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            }),
          ),
        )
      case 'albums':
        return Schema.decodeUnknownEffect(AlbumResponse)(input).pipe(
          Effect.map((item) =>
            fields({
              id: item.id,
              revision: item.revision,
              title: item.title,
              slug: item.slug,
              artistNames: item.artistNames,
              releaseDate: item.releaseDate,
              coverImageUrl: item.coverImageUrl,
              genres: item.genres,
              albumType: item.albumType,
              publishedAt: item.publishedAt,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            }),
          ),
        )
      case 'tracks':
        return Schema.decodeUnknownEffect(TrackResponse)(input).pipe(
          Effect.map((item) =>
            fields({
              id: item.id,
              revision: item.revision,
              title: item.title,
              slug: item.slug,
              artistNames: item.artistNames,
              coverImageUrl: item.coverImageUrl,
              albumId: item.albumId,
              trackNumber: item.trackNumber,
              publishedAt: item.publishedAt,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            }),
          ),
        )
      case 'labels':
        return Schema.decodeUnknownEffect(LabelResponse)(input).pipe(
          Effect.map((item) =>
            fields({
              id: item.id,
              revision: item.revision,
              name: item.name,
              slug: item.slug,
              description: item.description,
              content: item.content,
              imageUrl: item.imageUrl,
              bannerImageUrl: item.bannerImageUrl,
              tags: item.tags,
              genres: item.genres,
              publishedAt: item.publishedAt,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            }),
          ),
        )
    }
  }

  switch (pathname) {
    case '/api/music/artists':
      return Schema.decodeUnknownEffect(ArtistListResponse)(input).pipe(
        Effect.map((items) => ({
          ...rows(items.map((item) => catalogRow(item, item.name, 'artist'))),
          fields: { tab: 'artists' },
        })),
      )
    case '/api/music/albums':
      return Schema.decodeUnknownEffect(AlbumListResponse)(input).pipe(
        Effect.map((items) => ({
          ...rows(items.map((item) => catalogRow(item, item.title, 'album'))),
          fields: { tab: 'albums' },
        })),
      )
    case '/api/music/tracks':
      return Schema.decodeUnknownEffect(TrackListResponse)(input).pipe(
        Effect.map((items) => ({
          ...rows(items.map((item) => catalogRow(item, item.title, 'track'))),
          fields: { tab: 'tracks' },
        })),
      )
    case '/api/music/labels/manage':
      return Schema.decodeUnknownEffect(LabelListResponse)(input).pipe(
        Effect.map((items) => ({
          ...rows(items.map((item) => catalogRow(item, item.name, 'label'))),
          fields: { tab: 'labels' },
        })),
      )
    case '/api/music/playlists':
      return Schema.decodeUnknownEffect(PlaylistListResponse)(input).pipe(
        Effect.map((playlists) => ({
          ...rows(playlists.map((item) => catalogRow(item, item.title, 'playlist'))),
          playlists,
          fields: { tab: 'playlists' },
        })),
      )
    case '/api/music/playlists/import/spotify':
      return Schema.decodeUnknownEffect(ImportSpotifyPlaylistResponse)(input).pipe(
        Effect.map((playlistImport) => ({ ...emptyDocument, playlistImport })),
      )
    case '/api/user/mcp-connections':
      return Schema.decodeUnknownEffect(McpConnectionsResponse)(input).pipe(
        Effect.map(({ connections }) => ({ ...emptyDocument, connections })),
      )
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
          ...rows(mixes.map((mix) => ({ ...mix, detail: '', href: null, actionId: null }))),
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
            search: url.searchParams.get('searchValue') ?? '',
            offset: String(users.offset ?? url.searchParams.get('offset') ?? 0),
          },
        })),
      )
    case '/api/content/posts/manage':
      return Schema.decodeUnknownEffect(GetPostsResponse)(input).pipe(
        Effect.map(({ data, pagination }) => ({
          ...rows(
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
    case '/api/content/audio/mix/manage':
      return Schema.decodeUnknownEffect(GetAudioByTypeResponse)(input).pipe(
        Effect.map(({ data, pagination }) => ({
          ...rows(
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
    case '/api/search':
      return Schema.decodeUnknownEffect(SearchResults)(input).pipe(
        Effect.map(({ shows, audio, posts }) =>
          rows([
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
        Effect.map(({ username, email, bio }) =>
          fields({ username: username ?? '', email, bio: bio ?? '' }),
        ),
      )
    case '/api/user/email-preferences':
      return Schema.decodeUnknownEffect(
        Schema.Struct({
          mixReleaseEnabled: Schema.Boolean,
          promotionalEnabled: Schema.Boolean,
          systemEnabled: Schema.Boolean,
          globalUnsubscribe: Schema.Boolean,
        }),
      )(input).pipe(Effect.map((toggles) => ({ ...emptyDocument, toggles })))
    case '/api/favorites':
      return Schema.decodeUnknownEffect(GetFavoritesResponse)(input).pipe(
        Effect.map(({ favorites }) =>
          rows(
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
                membershipRevision: favorite.membershipRevision,
              }
            }),
          ),
        ),
      )
    case '/api/music-reminders':
      return Schema.decodeUnknownEffect(GetMusicRemindersResponse)(input).pipe(
        Effect.map(({ reminders }) =>
          rows(
            reminders.map((item) => {
              let state: string | null = null

              if (item.dispatchState === 'cancelled') state = 'Cancelled'
              else if (item.dispatchState === 'fenced') state = 'Delivery may have started'
              else if (item.dispatchState === 'accepted' || item.isSent || item.status === 'sent')
                state = 'Sent'

              return {
                id: item.id,
                title: item.musicTitle,
                detail: state ? `${item.artistName} · ${state}` : item.artistName,
                thumbnailUrl: item.albumCoverUrl,
                href: item.musicUrl,
                commandRevision: item.commandRevision,
                actionId:
                  item.dispatchState === 'open' && !item.isSent && item.status !== 'sent'
                    ? item.id
                    : null,
              }
            }),
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
          rows(
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
    case '/api/email/logs':
      return Schema.decodeUnknownEffect(EmailLogsResponse)(input).pipe(
        Effect.map((emailLogs) => ({
          ...emptyDocument,
          emailLogs,
          fields: Object.fromEntries(url.searchParams),
        })),
      )
    case '/api/admin/newsletter-subscribers':
      return Schema.decodeUnknownEffect(NewsletterSubscribersResponse)(input).pipe(
        Effect.map(({ subscribers }) => ({ ...emptyDocument, subscribers })),
      )
    case '/api/admin/overview':
      return Schema.decodeUnknownEffect(AdminOverviewResponse)(input).pipe(
        Effect.map(({ highlights }) => {
          const labels = [
            { id: 'totalUsers', title: 'Users' },
            { id: 'verifiedUsers', title: 'Verified users' },
            { id: 'newsletterSubscribers', title: 'Subscribers' },
            { id: 'totalPlayCount', title: 'Total plays' },
            { id: 'publishedMixes', title: 'Published mixes' },
            { id: 'newUsersLast7Days', title: 'New users (7 days)' },
            { id: 'newSubscribersLast30Days', title: 'New subscribers (30 days)' },
            { id: 'newMixesLast30Days', title: 'New mixes (30 days)' },
          ] satisfies ReadonlyArray<{
            readonly id: keyof typeof highlights
            readonly title: string
          }>

          return rows(
            labels.map(({ id, title }) => ({
              id,
              title,
              detail: new Intl.NumberFormat('en').format(highlights[id]),
              href: null,
              actionId: null,
            })),
          )
        }),
      )
    case '/api/admin/telemetry':
      return Schema.decodeUnknownEffect(AdminTelemetryResponse)(input).pipe(
        Effect.map((telemetry) => ({ ...emptyDocument, telemetry })),
      )
    default:
      return Effect.fail(
        new DashboardProjectionError({ message: 'Unsupported dashboard endpoint.' }),
      )
  }
}
