import { AdminTelemetryResponse, NewsletterSubscribersResponse } from '@gbfm/api/admin'
import {
  EmailLogsResponse,
  MixAnnouncementOptions,
  SendMixNotificationResponse,
} from '@gbfm/api/email'
import { MembershipRevision } from '@gbfm/api/favorites'
import { McpConnectionsResponse } from '@gbfm/api/mcp-connections'
import {
  ImportSpotifyPlaylistResponse,
  PlaylistListResponse,
  PlaylistTrackEntry,
  SyncPlaylistLinksResponse,
} from '@gbfm/api/music'
import { MusicReminderResponse } from '@gbfm/api/music-reminders'
import { GetAllShowsResponse } from '@gbfm/api/shows'
import { Schema } from 'effect'

export const AdminUsers = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
      username: Schema.optional(Schema.NullOr(Schema.String)),
      role: Schema.optional(Schema.NullOr(Schema.String)),
      banned: Schema.optional(Schema.NullOr(Schema.Boolean)),
      banReason: Schema.optional(Schema.NullOr(Schema.String)),
      emailVerified: Schema.optional(Schema.Boolean),
    }),
  ),
  total: Schema.Number,
  limit: Schema.Number,
  offset: Schema.optional(Schema.Number),
})

export const Row = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  detail: Schema.String,
  href: Schema.NullOr(Schema.String),
  actionId: Schema.NullOr(Schema.String),
  membershipRevision: Schema.optional(MembershipRevision),
  commandRevision: Schema.optional(MusicReminderResponse.fields.commandRevision),
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
