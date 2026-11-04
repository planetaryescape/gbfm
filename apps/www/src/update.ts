import * as Dialog from '@foldkit/ui/dialog'
import * as Popover from '@foldkit/ui/popover'
import { HashMap, Match, Option, Predicate, Result } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { UrlRequest } from 'foldkit/navigation'
import { toString as urlToString } from 'foldkit/url'

import {
  Leave,
  LoadPage,
  LoadReplies,
  Navigate,
  PauseCreatorUpload,
  PrefetchPage,
  Replace,
  ResetTweetEntry,
  SaveReadMode,
  SetResolvedUrl,
} from './command'
import { init, type Services } from './init'
import { Message } from './message'
import type { Flags, Model, PageCache } from './model'
import { isCacheable, pageKey, samePage, settlePage } from './page-cache'
import * as Creator from './page/creator'
import * as Dashboard from './page/dashboard'
import * as TweetReader from './page/tweet/reader'
import * as Player from './player'
import { syncPlayerFavorite } from './player-favorite'
import * as PublicActions from './public-actions'
import { isServerPath, Route } from './route'
import * as Search from './search'
import { dragOffset, shouldDismiss, startDrag } from './sheet-drag'
import * as SpotifyPlayback from './spotify/playback'

const mobileMenuFold = {
  read: (model: Model) => Option.some(model.mobileMenu),
  write: (model: Model, mobileMenu: Dialog.Model): Model => ({ ...model, mobileMenu }),
  toParentMessage: (message: Dialog.Message) => Message.GotMobileMenuMessage({ message }),
  foldOutMessage: Dialog.OutMessage.match<Update.Step<Model, Message>>({
    Opened: () => (model) => ({ model: { ...model, menuDrag: null, menuOffset: 0 } }),
    Closed: () => (model) => ({ model: { ...model, menuDrag: null } }),
  }),
}

const updateMobileMenu = Update.foldChild({ ...mobileMenuFold, update: Dialog.update })

const openMobileMenu = Update.foldChildStep({ ...mobileMenuFold, update: Dialog.open })

const closeMobileMenu = Update.foldChildStep({ ...mobileMenuFold, update: Dialog.close })

const accountMenuFold = {
  read: (model: Model) => Option.some(model.accountMenu),
  write: (model: Model, accountMenu: Popover.Model): Model => ({ ...model, accountMenu }),
  toParentMessage: (message: Popover.Message) => Message.GotAccountMenuMessage({ message }),
  foldOutMessage: Popover.OutMessage.match<Update.Step<Model, Message>>({
    Opened: () => (model) => ({ model }),
    Closed: () => (model) => ({ model }),
  }),
}

const updateAccountMenu = Update.foldChild({ ...accountMenuFold, update: Popover.update })

const closeAccountMenu = Update.foldChildStep({ ...accountMenuFold, update: Popover.close })

const closeSearch = (model: Model): Update.Return<Model, Message> => {
  const child = Search.close(model.search)

  return {
    model: { ...model, search: child.model },
    commands: Command.mapMessages(child.commands ?? [], (message) =>
      Message.GotSearchMessage({ message }),
    ),
  }
}

const closeOverlays = Update.combine([closeMobileMenu, closeAccountMenu, closeSearch])

const acceptTweet = (model: Model, initial = false): Update.Return<Model, Message> => {
  const slug = TweetReader.concreteSlug(model.flags.url)
  const post = model.flags.tweet?.post

  if (model.flags.status !== 200 || !slug || post?.slug !== slug) return { model }
  const identity = model.flags.principal?.id ?? 'anonymous'

  const reader =
    identity === model.tweetReader.identity ? model.tweetReader : TweetReader.init(identity)

  const visited = TweetReader.visit(
    reader,
    slug,
    model.navigationId,
    initial ? model.flags.neighbours : null,
    post.parentPostId ? null : new Date(post.createdAt).toISOString().slice(0, 7),
  )

  return {
    model: { ...model, tweetReader: visited.model },
    commands: [
      ...Command.mapMessages(visited.commands ?? [], (message) =>
        Message.GotTweetReaderMessage({ message }),
      ),
      ...(reader.current === slug && reader.navigationId === model.navigationId
        ? []
        : [LoadReplies({ slug, navigationId: model.navigationId })]),
    ],
  }
}

const showPage = (
  model: Model,
  flags: Flags,
  navigationId: number,
  expected: string,
): Update.Return<Model, Message, Services> => {
  const next = init(flags)
  const identityChanged = next.model.tweetReader.identity !== model.tweetReader.identity

  const keepPendingPublicAction =
    model.publicAction.busy &&
    model.publicAction.document !== null &&
    model.publicAction.principalId !== null &&
    model.publicAction.principalId === next.model.publicAction.principalId &&
    model.publicAction.document?.target.kind === next.model.publicAction.document?.target.kind &&
    model.publicAction.document?.target.id === next.model.publicAction.document?.target.id

  const sameTweet =
    !identityChanged &&
    flags.tweet &&
    model.flags.tweet &&
    flags.tweet.post.slug === model.flags.tweet.post.slug &&
    navigationId === model.navigationId &&
    model.tweetReader.current === flags.tweet.post.slug

  return {
    ...next,
    model: {
      ...next.model,
      flags:
        sameTweet && flags.tweet && model.flags.tweet
          ? { ...flags, tweet: { ...flags.tweet, replies: model.flags.tweet.replies } }
          : flags,
      repliesStatus: sameTweet ? model.repliesStatus : next.model.repliesStatus,
      player: model.player,
      spotifyPlayback: model.spotifyPlayback,
      skipSeen: model.skipSeen,
      mobileMenu: model.mobileMenu,
      menuDrag: model.menuDrag,
      menuOffset: model.menuOffset,
      accountMenu: model.accountMenu,
      search: model.search,
      pageCache: identityChanged ? next.model.pageCache : model.pageCache,
      tweetReader: identityChanged ? next.model.tweetReader : model.tweetReader,
      interactive: model.interactive,
      navigationId,
      navigationPrincipalId: model.navigationPrincipalId,
      navigationPrincipalKnown: model.navigationPrincipalKnown,
      navigationFavoriteChanges: model.navigationFavoriteChanges,
      publicAction: keepPendingPublicAction
        ? model.publicAction
        : {
            ...next.model.publicAction,
            requestId: model.publicAction.requestId + 1,
          },
    },
    commands: [
      ...Command.mapMessages(next.commands ?? [], (message) =>
        Match.value(message).pipe(
          Match.tag('GotCreatorResult', ({ message }) =>
            Message.GotCreatorResult({ message, navigationId }),
          ),
          Match.tag('GotDashboardResult', ({ message }) =>
            Message.GotDashboardResult({ message, navigationId }),
          ),
          Match.orElse((message) => message),
        ),
      ),
      SetResolvedUrl({
        href: flags.url,
        expected,
        metadata: flags.metadata,
        noindex:
          flags.status !== 200 ||
          flags.items.some((item) => item.draft) ||
          Route.guards.Dashboard(next.model.route) ||
          Route.guards.Composer(next.model.route) ||
          Route.guards.Auth(next.model.route) ||
          (Route.guards.Static(next.model.route) &&
            ['spotify-callback', 'listening'].includes(next.model.route.page)),
      }),
    ],
  }
}

const updateApplication = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, Services> =>
  Message.match<Update.Return<Model, Message, Services>>(message, {
    GotSpotifyPlaybackMessage: ({ message }) => {
      const child = SpotifyPlayback.update(model.spotifyPlayback, message)

      return {
        model: { ...model, spotifyPlayback: child.model },
        commands: Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotSpotifyPlaybackMessage({ message }),
        ),
      }
    },
    ClientStarted: () => {
      if (model.interactive) return { model }
      const started = { ...model, interactive: true }

      return TweetReader.isEntry(model.flags.url)
        ? {
            model: started,
            commands: [
              Command.mapMessage(
                TweetReader.ResolveEntry({
                  identity: model.tweetReader.identity,
                  checkpoint: model.tweetReader.checkpoint,
                  navigationId: model.navigationId,
                }),
                (message) => Message.GotTweetReaderMessage({ message }),
              ),
            ],
          }
        : acceptTweet(started, true)
    },
    GotTweetReaderMessage: ({ message }) => {
      if (Predicate.isTagged(message, 'EntryResolved')) {
        if (
          message.navigationId !== model.navigationId ||
          message.identity !== model.tweetReader.identity ||
          !TweetReader.isEntry(model.pendingPath ?? model.flags.url)
        )
          return { model }

        return {
          model: { ...model, tweetReader: { ...model.tweetReader, resumeSlug: message.slug } },
          commands: [
            Replace({
              href: message.slug ? `/tweet/${encodeURIComponent(message.slug)}` : '/tweet/latest',
              expected: pageKey(model.pendingPath ?? model.flags.url),
            }),
          ],
        }
      }

      const child = TweetReader.update(model.tweetReader, message)
      const next = { ...model, tweetReader: child.model }

      const commands: Array<Command.Command<Message, never, Services>> = [
        ...Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotTweetReaderMessage({ message }),
        ),
      ]

      if (Predicate.isTagged(message, 'LoadedNavigation') && child.model !== model.tweetReader) {
        const slugs = new Set([
          message.neighbours.newer,
          message.neighbours.older,
          message.neighbours.olderUnread,
          message.neighbours.newerUnread,
        ])

        let prefetched = next

        for (const slug of slugs) {
          if (!slug) continue

          const step = updateApplication(
            prefetched,
            Message.PrefetchRequested({ href: `/tweet/${encodeURIComponent(slug)}` }),
          )

          prefetched = step.model
          commands.push(...(step.commands ?? []))
        }

        return { model: prefetched, commands }
      }

      return {
        model: next,
        commands,
      }
    },
    AccountMenuClosed: () => closeAccountMenu(model),
    GotAccountMenuMessage: ({ message }) => updateAccountMenu(model, message),
    PasswordVisibilityToggled: () => ({
      model: { ...model, passwordVisible: !model.passwordVisible },
    }),
    AuthFormSubmitted: () => ({ model: { ...model, authSubmitting: true } }),
    AuthFormRestored: () => ({ model: { ...model, authSubmitting: false } }),
    ListeningDraftChanged: ({ id, change }) => {
      const draft =
        model.listeningDraft?.id === id
          ? model.listeningDraft
          : model.flags.listening?.document.mixes.find((mix) => mix.id === id)

      return draft ? { model: { ...model, listeningDraft: { ...draft, ...change } } } : { model }
    },
    ChallengeStatusChanged: ({ status }) => ({ model: { ...model, challengeStatus: status } }),
    MenuToggled: () => (model.mobileMenu.isOpen ? closeMobileMenu(model) : openMobileMenu(model)),
    NavMinimizeChanged: ({ minimized }) => ({ model: { ...model, navMinimized: minimized } }),
    GotMobileMenuMessage: ({ message }) => updateMobileMenu(model, message),
    MenuDragStarted: ({ pointerId, clientY }) =>
      !model.mobileMenu.isOpen ||
      model.mobileMenu.animation.transitionState !== 'Idle' ||
      model.menuDrag
        ? { model }
        : { model: { ...model, menuDrag: startDrag(pointerId, clientY, model.menuOffset) } },
    MenuDragMoved: ({ pointerId, clientY }) =>
      model.menuDrag?.pointerId === pointerId
        ? { model: { ...model, menuOffset: dragOffset(model.menuDrag, clientY) } }
        : { model },
    MenuDragReleased: ({ pointerId, clientY, viewportHeight }) => {
      if (model.menuDrag?.pointerId !== pointerId) return { model }
      const offset = dragOffset(model.menuDrag, clientY)
      const released = { ...model, menuDrag: null, menuOffset: offset }

      return shouldDismiss(offset, viewportHeight)
        ? closeMobileMenu(released)
        : { model: { ...released, menuOffset: 0 } }
    },
    MenuDragCancelled: () =>
      model.menuDrag ? { model: { ...model, menuDrag: null, menuOffset: 0 } } : { model },
    GotSearchMessage: ({ message }) => {
      const menu = Update.combine(model, [closeMobileMenu, closeAccountMenu])
      const child = Search.update(model.search, message)

      return {
        model: { ...menu.model, search: child.model },
        commands: [
          ...(menu.commands ?? []),
          ...Command.mapMessages(child.commands ?? [], (message) =>
            Message.GotSearchMessage({ message }),
          ),
        ],
      }
    },
    SkipSeenChanged: ({ value }) => ({
      model: { ...model, skipSeen: value },
      commands: [SaveReadMode({ value })],
    }),
    GotPublicActionMessage: ({ message }) => {
      if (model.publicAction.principalId !== model.player.favorite.principalId) return { model }
      const child = PublicActions.update(model.publicAction, message)

      return {
        model: { ...model, publicAction: child.model },
        commands: Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotPublicActionMessage({ message }),
        ),
      }
    },
    ReadModeFailed: () => ({
      model: { ...model, error: 'Could not save your tweet reading preference. Try again.' },
    }),
    MediaPreviewDenied: () => {
      const player = Player.closeOverlays(model.player)

      return {
        model: {
          ...model,
          player: player.model,
          error:
            'Private media preview is unavailable. Check your sign-in and permission, then try again.',
        },
        commands: Command.mapMessages(player.commands ?? [], (message) =>
          Message.GotPlayerMessage({ message }),
        ),
      }
    },
    LoadedReplies: ({ slug, replies, navigationId }) =>
      model.navigationId === navigationId && model.flags.tweet?.post.slug === slug
        ? {
            model: {
              ...model,
              repliesStatus: 'ready',
              flags: { ...model.flags, tweet: { ...model.flags.tweet, replies } },
            },
          }
        : { model },
    FailedReplies: ({ slug, navigationId }) =>
      model.navigationId === navigationId && model.flags.tweet?.post.slug === slug
        ? { model: { ...model, repliesStatus: 'error' } }
        : { model },
    GotPlayerMessage: ({ message }) => {
      const child = Player.update(model.player, message)

      return {
        model: { ...model, player: child.model },
        commands: Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotPlayerMessage({ message }),
        ),
      }
    },
    GotCreatorMessage: ({ message }) => {
      const child = Creator.update(model.creator, message)

      return {
        model: { ...model, creator: child.model },
        commands: Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotCreatorResult({ message, navigationId: model.navigationId }),
        ),
      }
    },
    GotCreatorResult: ({ message, navigationId }) =>
      navigationId === model.navigationId
        ? updateApplication(model, Message.GotCreatorMessage({ message }))
        : { model },
    GotDashboardMessage: ({ message }) => {
      const child = Dashboard.update(model.dashboard, message)

      const playback =
        Predicate.isTagged(message, 'SpotifyLoaded') && child.model !== model.dashboard
          ? SpotifyPlayback.update(
              model.spotifyPlayback,
              SpotifyPlayback.Message.ConnectionChanged({ status: child.model.spotify }),
            ).model
          : model.spotifyPlayback

      return {
        model: { ...model, dashboard: child.model, spotifyPlayback: playback },
        commands: Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotDashboardResult({ message, navigationId: model.navigationId }),
        ),
      }
    },
    GotDashboardResult: ({ message, navigationId }) =>
      navigationId === model.navigationId
        ? updateApplication(model, Message.GotDashboardMessage({ message }))
        : { model },
    RequestedUrl: ({ request }) =>
      UrlRequest.match<Update.Return<Model, Message, Services>>(request, {
        Internal: ({ url }) => {
          const menu = closeOverlays(model)

          return {
            model: menu.model,
            commands: [
              ...(menu.commands ?? []),
              isServerPath(url.pathname)
                ? Leave({ href: urlToString(url) })
                : Navigate({ href: urlToString(url) }),
            ],
          }
        },
        External: ({ href }) => {
          const menu = closeOverlays(model)

          return { model: menu.model, commands: [...(menu.commands ?? []), Leave({ href })] }
        },
      }),
    ChangedUrl: ({ url }) => {
      const menu = closeOverlays(model)
      const href = urlToString(url)
      const key = pageKey(href)
      const navigationId = model.navigationId + 1

      const entry =
        isCacheable(key) &&
        !(
          model.tweetReader.resumeSlug &&
          TweetReader.concreteSlug(href) === model.tweetReader.resumeSlug
        )
          ? AsyncData.fromOptionOrIdle(HashMap.get(model.pageCache, key))
          : AsyncData.Idle()

      const transition = AsyncData.revalidateOrLoad(entry)

      const pageCache = Option.match(transition, {
        onNone: () => model.pageCache,
        onSome: (next) =>
          isCacheable(key) ? HashMap.set(model.pageCache, key, next) : model.pageCache,
      })

      const player = Player.closeOverlays(model.player)

      const leaving = {
        ...menu.model,
        pageCache,
        navigationId,
        navigationPrincipalId: model.player.favorite.principalId,
        navigationPrincipalKnown: model.player.favorite.principalKnown,
        navigationFavoriteChanges: [],
        player: player.model,
        tweetReader: {
          ...model.tweetReader,
          current: null,
          neighbours: null,
          navigationId,
          returnSlug:
            url.pathname === '/tweet/latest'
              ? (model.tweetReader.returnSlug ?? model.tweetReader.current)
              : model.tweetReader.returnSlug,
          resumeSlug:
            TweetReader.concreteSlug(href) === model.tweetReader.resumeSlug
              ? model.tweetReader.resumeSlug
              : null,
        },
      }

      if (TweetReader.isEntry(href))
        return {
          model: { ...leaving, loading: true, pendingPath: key },
          commands: [
            ...(menu.commands ?? []),
            ...Command.mapMessages(player.commands ?? [], (message) =>
              Message.GotPlayerMessage({ message }),
            ),
            ...(model.creator.uploadState === 'running' ? [PauseCreatorUpload()] : []),
            Command.mapMessage(
              TweetReader.ResolveEntry({
                checkpoint: model.tweetReader.checkpoint,
                navigationId,
                identity: model.tweetReader.identity,
              }),
              (message) => Message.GotTweetReaderMessage({ message }),
            ),
          ],
        }

      const commands = [
        ...(menu.commands ?? []),
        ...Command.mapMessages(player.commands ?? [], (message) =>
          Message.GotPlayerMessage({ message }),
        ),
        ...(model.creator.uploadState === 'running' ? [PauseCreatorUpload()] : []),
        LoadPage({ href, navigationId }),
      ]

      return Option.match(AsyncData.getData(entry), {
        onNone: () => ({
          model: { ...leaving, loading: true, pendingPath: url.pathname },
          commands,
        }),
        onSome: (flags) => {
          if (
            pageKey(flags.url) !== key ||
            flags.status !== 200 ||
            flags.principal?.id !== model.flags.principal?.id
          )
            return { model: { ...leaving, loading: true, pendingPath: key }, commands }
          const shown = showPage(leaving, flags, navigationId, key)
          const accepted = acceptTweet(shown.model)

          return {
            model: accepted.model,
            commands: [...commands, ...(shown.commands ?? []), ...(accepted.commands ?? [])],
          }
        },
      })
    },
    PrefetchRequested: ({ href }) => {
      const key = pageKey(href)

      if (!isCacheable(key)) return { model }

      return Option.match(
        AsyncData.loadIfMissing(AsyncData.fromOptionOrIdle(HashMap.get(model.pageCache, key))),
        {
          onNone: () => ({ model }),
          onSome: (loading) => ({
            model: { ...model, pageCache: HashMap.set(model.pageCache, key, loading) },
            commands: [PrefetchPage({ href })],
          }),
        },
      )
    },
    PrefetchedPage: ({ flags, key }) => ({
      model: {
        ...model,
        pageCache: settlePage(
          settlePage(model.pageCache, key, Result.succeed(flags)),
          pageKey(flags.url),
          Result.succeed(flags),
        ),
      },
    }),
    LoadedPage: ({ flags, key, navigationId }) => {
      if (navigationId !== model.navigationId) return { model }

      if (
        flags.status === 404 &&
        model.tweetReader.resumeSlug &&
        TweetReader.concreteSlug(flags.url) === model.tweetReader.resumeSlug
      )
        return {
          model: {
            ...model,
            tweetReader: { ...model.tweetReader, checkpoint: null, resumeSlug: null },
          },
          commands: [ResetTweetEntry({ expected: key, identity: model.tweetReader.identity })],
        }

      const sourceCache: PageCache =
        (flags.principal?.id ?? 'anonymous') === model.tweetReader.identity
          ? model.pageCache
          : HashMap.empty()

      const pageCache = settlePage(
        settlePage(sourceCache, key, Result.succeed(flags)),
        pageKey(flags.url),
        Result.succeed(flags),
      )

      if (
        !model.loading &&
        samePage(model.flags, flags) &&
        (flags.publicAction?.target.kind !== 'audio' ||
          model.publicAction.document?.state === flags.publicAction.state)
      )
        return acceptTweet({ ...model, pageCache })

      const shown = showPage(model, flags, navigationId, key)
      const accepted = acceptTweet(shown.model)

      return {
        model: { ...accepted.model, pageCache },
        commands: [...(shown.commands ?? []), ...(accepted.commands ?? [])],
      }
    },
    FailedPage: ({ key, navigationId }) => {
      if (navigationId !== model.navigationId) return { model }

      const pageCache = settlePage(
        model.pageCache,
        key,
        Result.fail('This page could not be loaded.'),
      )

      return {
        model:
          navigationId === model.navigationId && model.loading
            ? {
                ...model,
                pageCache,
                loading: false,
                pendingPath: null,
                error: 'This page could not be loaded. Please try again.',
              }
            : { ...model, pageCache },
        commands:
          model.flags.tweet && TweetReader.concreteSlug(key) && key !== pageKey(model.flags.url)
            ? [Replace({ href: model.flags.url, expected: key })]
            : [],
      }
    },
    NavigationCompleted: () => ({ model }),
  })

export const update = (model: Model, message: Message): Update.Return<Model, Message, Services> =>
  syncPlayerFavorite(model, message, updateApplication(model, message))

/** The page the screen is showing: the pending destination while loading, else the loaded page. */
export const displayedPath = (model: Model) =>
  model.loading && model.pendingPath ? model.pendingPath : new URL(model.flags.url).pathname
