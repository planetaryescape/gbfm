import * as Dialog from '@foldkit/ui/dialog'
import * as Popover from '@foldkit/ui/popover'
import { AudioResponse, AudioShow } from '@gbfm/api/audio'
import { SavedMix } from '@gbfm/api/listening'
import { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { MicroPostScreenResponse } from '@gbfm/api/post'
import { PublicProfileResponse } from '@gbfm/api/profile'
import { ReleaseResponse } from '@gbfm/api/release'
import { RichContentDocument } from '@gbfm/rich-content/schema'
import { SiteMetadata } from '@gbfm/site-metadata'
import { type HashMap, Schema } from 'effect'
import { AsyncData } from 'foldkit'

import * as Creator from './page/creator'
import * as Dashboard from './page/dashboard'
import { DashboardDocument } from './page/dashboard/document'
import { ListeningPage } from './page/listening/document'
import { ShowsDocument } from './page/shows/document'
import * as TweetReader from './page/tweet/reader'
import * as Player from './player'
import * as PublicActions from './public-actions'
import { Route } from './route'
import * as Search from './search'
import { SheetDrag } from './sheet-drag'
import { Status as ChallengeStatus } from './signup-challenge/model'
import * as SpotifyPlayback from './spotify/playback'

export const Principal = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  username: Schema.NullOr(Schema.String),
  image: Schema.optional(Schema.NullOr(Schema.String)),
  role: Schema.NullOr(Schema.String),
})

export type Principal = typeof Principal.Type

export const ContentItem = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
  href: Schema.String,
  meta: Schema.NullOr(Schema.String),
  content: Schema.String,
  richContent: Schema.NullOr(RichContentDocument),
  audioUrl: Schema.NullOr(Schema.String),
  audioType: Schema.NullOr(AudioResponse.fields.type),
  show: Schema.NullOr(AudioShow),
  creators: AudioResponse.fields.creators,
  tags: ReleaseResponse.fields.tags,
  streamingLinks: ReleaseResponse.fields.streamingLinks,
  draft: Schema.optional(Schema.Boolean),
})

export type ContentItem = typeof ContentItem.Type

export const Flags = Schema.Struct({
  url: Schema.String,
  turnstileSiteKey: Schema.optional(Schema.String),
  status: Schema.Number,
  principal: Schema.NullOr(Principal),
  principalKnown: Schema.optional(Schema.Boolean),
  items: Schema.Array(ContentItem),
  title: Schema.String,
  description: Schema.String,
  requestId: Schema.String,
  renderedAt: Schema.Number,
  skipSeen: Schema.Boolean,
  tweet: Schema.NullOr(MicroPostScreenResponse),
  neighbours: Schema.NullOr(MicroPostNeighboursResponse),
  dashboard: Schema.NullOr(DashboardDocument),
  listening: Schema.optional(ListeningPage),
  profile: Schema.NullOr(PublicProfileResponse),
  shows: Schema.NullOr(ShowsDocument),
  changelog: Schema.NullOr(RichContentDocument),
  publicAction: Schema.NullOr(PublicActions.Document),
  metadata: Schema.NullOr(SiteMetadata),
  failure: Schema.NullOr(Schema.String),
})

export type Flags = typeof Flags.Type

/** Stale-while-revalidate page data per URL, so revisits render immediately while a fresh copy loads. */
export const PageData = AsyncData.Schema(Flags, Schema.String)

export type PageCache = HashMap.HashMap<string, AsyncData.AsyncData<Flags, string>>

export const Model = Schema.Struct({
  route: Route,
  challengeStatus: ChallengeStatus,
  flags: Flags,
  mobileMenu: Dialog.Model,
  menuDrag: SheetDrag,
  menuOffset: Schema.Number,
  navMinimized: Schema.Boolean,
  accountMenu: Popover.Model,
  search: Search.Model,
  skipSeen: Schema.Boolean,
  loading: Schema.Boolean,
  pendingPath: Schema.NullOr(Schema.String),
  pageCache: Schema.HashMap(Schema.String, PageData.schema),
  interactive: Schema.Boolean,
  passwordVisible: Schema.Boolean,
  authSubmitting: Schema.Boolean,
  navigationId: Schema.Number,
  navigationPrincipalId: Schema.NullOr(Schema.String),
  navigationPrincipalKnown: Schema.Boolean,
  navigationFavoriteChanges: Schema.Array(
    Schema.Struct({ principalId: Schema.String, audioId: Schema.String, active: Schema.Boolean }),
  ),
  tweetReader: TweetReader.Model,
  error: Schema.NullOr(Schema.String),
  repliesStatus: Schema.Literals(['loading', 'ready', 'error']),
  player: Player.Model,
  publicAction: PublicActions.Model,
  spotifyPlayback: SpotifyPlayback.Model,
  creator: Creator.Model,
  dashboard: Dashboard.Model,
  listeningDraft: Schema.NullOr(SavedMix),
})

export type Model = typeof Model.Type
