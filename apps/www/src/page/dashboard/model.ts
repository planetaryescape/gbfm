import { ROLES } from '@gbfm/core/roles'
import { Schema } from 'effect'

import { SpotifyStatus } from '../../spotify/connection'
import { DashboardDocument, Row } from './document'
import * as ApiKeys from './page/api-keys'
import * as Emails from './page/emails'
import * as Playlists from './page/playlists'
import * as Sessions from './page/sessions'
import * as Shows from './page/shows'

export const Role = Schema.NullOr(Schema.Literals(ROLES))

export type Role = typeof Role.Type

export const Principal = Schema.Struct({ id: Schema.String, role: Role })

export type Principal = typeof Principal.Type

export const Model = Schema.Struct({
  section: Schema.String,
  principal: Principal,
  phase: Schema.Literals(['loading', 'ready', 'saving', 'error']),
  rows: Schema.Array(Row),
  pagination: DashboardDocument.fields.pagination,
  fields: Schema.Record(Schema.String, Schema.String),
  toggles: Schema.Record(Schema.String, Schema.Boolean),
  error: Schema.NullOr(Schema.String),
  spotify: SpotifyStatus,
  telemetry: DashboardDocument.fields.telemetry,
  users: DashboardDocument.fields.users,
  subscribers: DashboardDocument.fields.subscribers,
  emailLogs: DashboardDocument.fields.emailLogs,
  emails: Emails.Model,
  sessions: Sessions.Model,
  shows: Shows.Model,
  playlists: Playlists.Model,
  apiKeys: ApiKeys.Model,
  catalogRevision: Schema.Number,
  catalogNotice: Schema.String,
})

export type Model = typeof Model.Type
