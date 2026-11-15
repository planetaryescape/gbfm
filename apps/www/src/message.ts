import * as Dialog from '@foldkit/ui/dialog'
import * as Popover from '@foldkit/ui/popover'
import { SavedMix } from '@gbfm/api/listening'
import { MicroPostScreenRepliesResponse } from '@gbfm/api/post'
import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { Url } from 'foldkit/url'

import { Flags } from './model'
import * as Creator from './page/creator'
import * as Dashboard from './page/dashboard'
import * as TweetReader from './page/tweet/reader'
import * as Player from './player'
import * as PublicActions from './public-actions'
import * as Search from './search'
import { Status as ChallengeStatus } from './signup-challenge/model'
import * as SpotifyPlayback from './spotify/playback'
import { SpotlightProgress } from './spotlight-progress'
import { Video } from './video'

export const Message = defineMessageUnion({
  ClientStarted: {},
  MediaPreviewDenied: {},
  ChallengeStatusChanged: { status: ChallengeStatus },
  GotTweetReaderMessage: { message: TweetReader.Message },
  MenuToggled: {},
  NavMinimizeChanged: { minimized: Schema.Boolean },
  PasswordVisibilityToggled: {},
  AuthFormSubmitted: {},
  AuthFormRestored: {},
  ListeningDraftChanged: {
    id: Schema.String,
    change: Schema.Union([
      Schema.Struct({ title: Schema.String }),
      Schema.Struct({ notes: Schema.String }),
      Schema.Struct({ status: SavedMix.fields.status }),
      Schema.Struct({ published: Schema.Boolean }),
    ]),
  },
  GotMobileMenuMessage: { message: Dialog.Message },
  VideoOpened: { video: Video },
  GotVideoDialogMessage: { message: Dialog.Message },
  SpotlightStepped: { path: Schema.String, at: Schema.NullOr(Schema.String) },
  SpotlightRestored: { progress: SpotlightProgress },
  SpotlightSynced: {},
  SpotlightKeyed: { offset: Schema.Number },
  MenuDragStarted: { pointerId: Schema.Number, clientY: Schema.Number },
  MenuDragMoved: { pointerId: Schema.Number, clientY: Schema.Number },
  MenuDragReleased: {
    pointerId: Schema.Number,
    clientY: Schema.Number,
    viewportHeight: Schema.Number,
  },
  MenuDragCancelled: {},
  AccountMenuClosed: {},
  GotAccountMenuMessage: { message: Popover.Message },
  GotSearchMessage: { message: Search.Message },
  GotPublicActionMessage: { message: PublicActions.Message },
  GotSpotifyPlaybackMessage: { message: SpotifyPlayback.Message },
  SkipSeenChanged: { value: Schema.Boolean },
  ReadModeFailed: {},
  GotPlayerMessage: { message: Player.Message },
  GotCreatorMessage: { message: Creator.Message },
  GotCreatorResult: { message: Creator.Message, navigationId: Schema.Number },
  GotDashboardMessage: { message: Dashboard.Message },
  GotDashboardResult: { message: Dashboard.Message, navigationId: Schema.Number },
  RequestedUrl: { request: UrlRequest },
  ChangedUrl: { url: Url },
  LoadedPage: { flags: Flags, key: Schema.String, navigationId: Schema.Number },
  FailedPage: { key: Schema.String, navigationId: Schema.Number },
  LoadedReplies: {
    slug: Schema.String,
    replies: MicroPostScreenRepliesResponse,
    navigationId: Schema.Number,
  },
  FailedReplies: { slug: Schema.String, navigationId: Schema.Number },
  NavigationCompleted: {},
  PrefetchedPage: { flags: Flags, key: Schema.String },
  PrefetchRequested: { href: Schema.String },
})

export type Message = typeof Message.Type
