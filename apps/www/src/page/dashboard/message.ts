import { PlayerPreferences } from '@gbfm/player'
import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { SpotifyStatus } from '../../spotify/connection'
import { Theme } from '../../theme'
import { Row, DashboardDocument } from './document'
import { DeleteIntent } from './model'
import * as ApiKeys from './page/api-keys'
import * as Emails from './page/emails'
import * as Playlists from './page/playlists'
import * as Sessions from './page/sessions'
import * as Shows from './page/shows'

export const CatalogOperation = Schema.Literals([
  'save',
  'delete',
  'add-link',
  'remove-link',
  'create-label',
])

export const Message = defineMessageUnion({
  GotApiKeyMessage: { message: ApiKeys.Message },
  GotEmailMessage: { message: Emails.Message },
  SaveCatalogEntity: {},
  DeleteCatalogEntity: {},
  AddCatalogLink: {},
  DeleteCatalogLink: { id: Schema.String },
  CreateLabel: {},
  CatalogCompleted: { operation: CatalogOperation },
  CatalogLinksLoaded: { rows: Schema.Array(Row), revision: Schema.Number },
  CatalogLinksFailed: { revision: Schema.Number },
  GotSessionMessage: { message: Sessions.Message },
  GotShowMessage: { message: Shows.Message },
  GotPlaylistMessage: { message: Playlists.Message },
  LoadRequested: {},
  Loaded: { document: DashboardDocument },
  Failed: { message: Schema.String },
  ConnectionsUnavailable: {},
  FieldChanged: { name: Schema.String, value: Schema.String },
  ToggleChanged: { name: Schema.String, value: Schema.Boolean },
  SaveProfile: {},
  SaveFeaturedMix: {},
  SaveEmailPreferences: {},
  SavePlayerPreferences: {},
  PlayerPreferencesLoaded: { preferences: PlayerPreferences },
  ThemeSelected: { theme: Theme },
  ThemeRestored: { theme: Theme },
  DeleteRequested: { id: Schema.String },
  DeleteCompleted: { intent: DeleteIntent },
  DeleteFailed: {
    intent: DeleteIntent,
    message: Schema.String,
    status: Schema.NullOr(Schema.Number),
  },
  Saved: {},
  SpotifyRequested: {
    action: Schema.Literals(['status', 'connect', 'disconnect', 'completeCallback']),
  },
  SpotifyLoaded: { requestId: Schema.Number, status: SpotifyStatus },
  SpotifyFailed: { requestId: Schema.Number, message: Schema.String },
})

export type Message = typeof Message.Type
