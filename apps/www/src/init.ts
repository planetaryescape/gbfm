import * as Dialog from '@foldkit/ui/dialog'
import * as Popover from '@foldkit/ui/popover'
import { canCreatePosts, isRole } from '@gbfm/core/roles'
import { Match } from 'effect'
import { Command, type Runtime } from 'foldkit'

import { StartClient } from './command'
import { Message } from './message'
import type { Flags, Model } from './model'
import { seedCache } from './page-cache'
import * as Creator from './page/creator'
import * as Dashboard from './page/dashboard'
import * as TweetReader from './page/tweet/reader'
import * as Player from './player'
import * as PublicActions from './public-actions'
import { parseRoute } from './route'
import * as Search from './search'
import type { SpotifyConnection } from './spotify/connection'
import * as SpotifyPlayback from './spotify/playback'

export type Services =
  | Player.PlayerClient
  | Creator.CreatorService
  | Creator.CreatorUpload
  | Dashboard.DashboardService
  | Dashboard.SessionService
  | Dashboard.KeyService
  | SpotifyConnection

export const init = (
  flags: Flags,
  retainedPlayback: SpotifyPlayback.Model = SpotifyPlayback.initialModel,
): ReturnType<Runtime.ApplicationInit<Model, Message, Flags, Services>> => {
  const spotifyPlayback = flags.tweet
    ? { ...retainedPlayback, statusRequestId: retainedPlayback.statusRequestId + 1 }
    : retainedPlayback

  const url = new URL(flags.url)
  const route = parseRoute(url.pathname)
  const role = flags.principal?.role ?? null

  const creatorKind = Match.value(route).pipe(
    Match.tag('Composer', ({ kind }) => kind),
    Match.orElse(() => ''),
  )

  const creator = Creator.init({
    kind: Match.value(creatorKind).pipe(
      Match.when('mix', () => 'mix' as const),
      Match.when('editorial', () => 'post' as const),
      Match.orElse(() => 'micro' as const),
    ),
    editSlug: url.searchParams.get('edit'),
    creatorId: flags.principal?.id ?? '',
    authorized: canCreatePosts(role),
  })

  const section = Match.value(route).pipe(
    Match.tag('Dashboard', ({ section }) => section),
    Match.tag('Static', ({ page }) => (page === 'spotify-callback' ? page : '')),
    Match.orElse(() => ''),
  )

  const dashboard = Dashboard.init(
    section || 'favorites',
    {
      id: flags.principal?.id ?? '',
      role: role && isRole(role) ? role : null,
    },
    url.searchParams,
  )()

  const preparedDashboard = flags.dashboard
    ? Dashboard.update(dashboard.model, Dashboard.Message.Loaded({ document: flags.dashboard }))
    : dashboard

  return {
    model: {
      route,
      challengeStatus: 'verifying',
      flags,
      mobileMenu: Dialog.init({ id: 'mobile-menu', isAnimated: true }),
      menuDrag: null,
      menuOffset: 0,
      navMinimized: false,
      accountMenu: Popover.init({ id: 'account-menu', contentFocus: true }),
      search: Search.initialModel,
      skipSeen: flags.skipSeen,
      loading: false,
      pendingPath: null,
      pageCache: seedCache(flags),
      interactive: false,
      passwordVisible: false,
      authSubmitting: false,
      navigationId: 0,
      navigationPrincipalId: flags.principal?.id ?? null,
      navigationPrincipalKnown: flags.principal !== null || flags.principalKnown === true,
      navigationFavoriteChanges: [],
      tweetReader: TweetReader.init(flags.principal?.id ?? 'anonymous'),
      error: null,
      repliesStatus: flags.tweet ? 'loading' : 'ready',
      player: {
        ...Player.initialModel,
        favorite: {
          ...Player.Favorite.initialModel,
          principalId: flags.principal?.id ?? null,
          principalKnown: flags.principal !== null || flags.principalKnown === true,
        },
      },
      publicAction: PublicActions.init(flags.publicAction, flags.principal?.id ?? null),
      spotifyPlayback,
      creator: creator.model,
      dashboard: preparedDashboard.model,
      listeningDraft: null,
    },
    commands: [
      StartClient(),
      ...(flags.tweet
        ? [
            Command.mapMessage(
              SpotifyPlayback.Load({ requestId: spotifyPlayback.statusRequestId }),
              (message) => Message.GotSpotifyPlaybackMessage({ message }),
            ),
          ]
        : []),
      ...(creatorKind
        ? Command.mapMessages(creator.commands ?? [], (message) =>
            Message.GotCreatorResult({ message, navigationId: 0 }),
          )
        : []),
      ...(section && (flags.principal || section === 'spotify-callback')
        ? Command.mapMessages(preparedDashboard.commands ?? [], (message) =>
            Message.GotDashboardResult({ message, navigationId: 0 }),
          )
        : []),
    ],
  }
}
