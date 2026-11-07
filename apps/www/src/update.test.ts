import { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { MicroPostScreenResponse } from '@gbfm/api/post'
import { HashMap, Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { fromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'

import { init } from './init'
import { Message } from './message'
import type { Flags } from './model'
import { readerViewState } from './observability/reader-state'
import { isCacheable, seedCache } from './page-cache'
import { Message as CreatorMessage } from './page/creator/message'
import { Message as DashboardMessage } from './page/dashboard/message'
import * as Reader from './page/tweet/reader'
import { parseRoute, Route } from './route'
import { update } from './update'

const flags: Flags = {
  url: 'https://gbfm.co.za/new/mix',
  status: 200,
  principal: null,
  items: [],
  title: 'Create',
  description: '',
  requestId: 'test',
  renderedAt: 0,
  skipSeen: false,
  tweet: null,
  neighbours: null,
  dashboard: null,
  profile: null,
  shows: null,
  changelog: null,
  publicAction: null,
  metadata: null,
  failure: null,
}

const tweetFlags = (slug: string): Flags => {
  const post = {
    id: slug,
    slug,
    title: null,
    description: null,
    thumbnailUrl: null,
    content: slug,
    draft: false,
    tags: [],
    type: 'micro',
    musicEntityType: null,
    musicEntityId: null,
    parentPostId: null,
    rootPostId: null,
    depth: 0,
    quotedPostId: null,
    createdAt: '2024-04-01T00:00:00Z',
    updatedAt: '2024-04-01T00:00:00Z',
    compiledContent: slug,
    music: null,
  }

  return {
    ...flags,
    url: `https://gbfm.co.za/tweet/${slug}`,
    tweet: Schema.decodeUnknownSync(MicroPostScreenResponse)({
      post,
      root: post,
      replies: [],
      quote: null,
    }),
    neighbours: Schema.decodeUnknownSync(MicroPostNeighboursResponse)({
      newer: 'c',
      older: 'a',
      olderUnread: 'a',
      newerUnread: 'c',
      seen: false,
      unreadCount: 2,
      timeline: [],
    }),
  }
}

const changed = (href: string) => Message.ChangedUrl({ url: Option.getOrThrow(fromString(href)) })

describe('reader observability projection at the real model transition boundary', () => {
  it('keeps the owned request loading until content commits and ignores stale completions', () => {
    const initial = init({ ...flags, url: 'https://gbfm.co.za/about' }).model
    const loading = update(initial, changed('https://gbfm.co.za/tweet/first')).model
    expect(readerViewState(loading)).toEqual({
      active: true,
      request: loading.navigationId,
      status: 'loading',
    })
    const next = update(loading, changed('https://gbfm.co.za/tweet/second')).model

    const stale = update(
      next,
      Message.LoadedPage({
        flags: tweetFlags('first'),
        key: '/tweet/first',
        navigationId: loading.navigationId,
      }),
    ).model

    expect(readerViewState(stale)).toEqual({
      active: true,
      request: next.navigationId,
      status: 'loading',
    })

    const committed = update(
      stale,
      Message.LoadedPage({
        flags: tweetFlags('second'),
        key: '/tweet/second',
        navigationId: next.navigationId,
      }),
    ).model

    expect(readerViewState(committed)).toEqual({
      active: true,
      request: next.navigationId,
      status: 'ready',
    })
  })

  it('distinguishes empty committed content from failed navigation', () => {
    const initial = init({ ...flags, url: 'https://gbfm.co.za/about' }).model
    const loading = update(initial, changed('https://gbfm.co.za/tweet/missing')).model

    const failed = update(
      loading,
      Message.FailedPage({ key: '/tweet/missing', navigationId: loading.navigationId }),
    ).model

    expect(readerViewState(failed).status).toBe('error')

    const empty = update(
      loading,
      Message.LoadedPage({
        flags: { ...flags, url: 'https://gbfm.co.za/tweet/missing', status: 404 },
        key: '/tweet/missing',
        navigationId: loading.navigationId,
      }),
    ).model

    expect(readerViewState(empty)).toEqual({
      active: true,
      request: loading.navigationId,
      status: 'empty',
    })
  })
})

describe('page navigation and cached revalidation', () => {
  const about: Flags = { ...flags, url: 'https://gbfm.co.za/about', title: 'About' }
  const mixes: Flags = { ...flags, url: 'https://gbfm.co.za/mixes', title: 'Mixes' }

  it('keeps the visible page during a cold load and rejects out-of-order success and failure', () => {
    const initial = init(about).model
    const first = update(initial, changed(mixes.url)).model
    expect(first.flags).toBe(initial.flags)
    expect(first.loading).toBe(true)
    expect(first.pendingPath).toBe('/mixes')
    const second = update(first, changed('https://gbfm.co.za/editorial')).model
    expect(
      update(
        second,
        Message.LoadedPage({ flags: mixes, key: '/mixes', navigationId: first.navigationId }),
      ),
    ).toEqual({ model: second })
    expect(
      update(second, Message.FailedPage({ key: '/mixes', navigationId: first.navigationId })),
    ).toEqual({ model: second })

    const failed = update(
      second,
      Message.FailedPage({ key: '/editorial', navigationId: second.navigationId }),
    ).model

    expect(failed.flags).toBe(initial.flags)
    expect(failed.loading).toBe(false)
    expect(failed.pendingPath).toBeNull()
    expect(failed.error).toContain('could not be loaded')
  })

  it('shows cached content immediately and keeps it after failed revalidation', () => {
    const initial = update(
      init(about).model,
      Message.PrefetchedPage({ flags: mixes, key: '/mixes' }),
    ).model

    const navigation = update(initial, changed(mixes.url)).model
    expect(navigation.flags).toEqual(mixes)
    expect(navigation.loading).toBe(false)
    expect(
      AsyncData.isRefreshing(Option.getOrThrow(HashMap.get(navigation.pageCache, '/mixes'))),
    ).toBe(true)

    const failed = update(
      navigation,
      Message.FailedPage({ key: '/mixes', navigationId: navigation.navigationId }),
    ).model

    const entry = Option.getOrThrow(HashMap.get(failed.pageCache, '/mixes'))
    expect(AsyncData.isStale(entry)).toBe(true)
    expect(Option.getOrThrow(AsyncData.getData(entry))).toEqual(mixes)
    expect(failed.flags).toEqual(mixes)
    expect(failed.error).toBeNull()
  })

  it('does not display cached content from another principal and clears it on identity change', () => {
    const principal = { id: 'account-a', name: null, username: null, role: null }

    const otherMixes: Flags = {
      ...mixes,
      principal: { ...principal, id: 'account-b' },
      title: 'Account B mixes',
    }

    const initial = update(
      init({ ...about, principal }).model,
      Message.PrefetchedPage({ flags: otherMixes, key: '/mixes' }),
    ).model

    expect(
      Option.getOrThrow(
        AsyncData.getData(Option.getOrThrow(HashMap.get(initial.pageCache, '/mixes'))),
      ),
    ).toEqual(otherMixes)
    const navigation = update(initial, changed(mixes.url)).model
    expect(navigation.loading).toBe(true)
    expect(navigation.flags).toBe(initial.flags)
    expect(navigation.pendingPath).toBe('/mixes')

    const loaded = update(
      navigation,
      Message.LoadedPage({
        flags: { ...mixes, principalKnown: true },
        key: '/mixes',
        navigationId: navigation.navigationId,
      }),
    ).model

    expect(loaded.tweetReader.identity).toBe('anonymous')
    expect(HashMap.has(loaded.pageCache, '/about')).toBe(false)
    expect(
      Option.getOrThrow(
        AsyncData.getData(Option.getOrThrow(HashMap.get(loaded.pageCache, '/mixes'))),
      ).principal,
    ).toBeNull()
    expect(loaded.player.favorite.principalId).toBeNull()
    expect(loaded.player.favorite.principalKnown).toBe(true)
  })

  it.each(['https://gbfm.co.za/mixes', 'https://gbfm.co.za/tweets'])(
    'requests upload suspension before leaving for %s without discarding the draft',
    (href) => {
      const initial = init(flags).model

      const running: typeof initial = {
        ...initial,
        creator: {
          ...initial.creator,
          uploadState: 'running',
          draft: { ...initial.creator.draft, content: 'Keep this draft' },
        },
      }

      const leaving = update(running, changed(href))
      expect(leaving.commands?.map((command) => command.name)).toContain(
        'Application.PauseCreatorUpload',
      )
      expect(leaving.model.creator).toBe(running.creator)
      expect(leaving.model.creator.draft.content).toBe('Keep this draft')
    },
  )
})

it('reveals preview denial outside the player overlays without losing playback position', () => {
  const initial = init(flags).model

  const snapshot = {
    ...initial.player.snapshot,
    transport: { ...initial.player.snapshot.transport, currentTime: 83, duration: 180 },
  }

  const model = {
    ...initial,
    player: {
      ...initial.player,
      snapshot,
      playerDialog: { ...initial.player.playerDialog, isOpen: true },
      queueDialog: { ...initial.player.queueDialog, isOpen: true },
    },
  }

  const denied = update(model, Message.MediaPreviewDenied()).model

  expect(denied.error).toContain('Private media preview is unavailable')
  expect(denied.player.playerDialog.isOpen).toBe(false)
  expect(denied.player.queueDialog.isOpen).toBe(false)
  expect(denied.player.snapshot).toEqual(snapshot)
})

describe('Tweet reader navigation ownership', () => {
  it('preserves unrelated submodels on identical revalidation and scopes reader metadata to identity', () => {
    const initial = init(flags).model

    const editing = {
      ...initial,
      creator: { ...initial.creator, draft: { ...initial.creator.draft, content: 'Unsaved work' } },
    }

    expect(
      update(editing, Message.LoadedPage({ flags, key: '/new/mix', navigationId: 0 })).model.creator
        .draft.content,
    ).toBe('Unsaved work')
    const a = tweetFlags('a')

    const cached = update(
      init(a).model,
      Message.PrefetchedPage({ flags: tweetFlags('b'), key: '/tweet/b' }),
    ).model

    const signedIn = { ...a, principal: { id: 'user', name: null, username: null, role: null } }

    const result = update(
      cached,
      Message.LoadedPage({ flags: signedIn, key: '/tweet/a', navigationId: 0 }),
    ).model

    expect(result.tweetReader.identity).toBe('user')
    expect(HashMap.has(result.pageCache, '/tweet/b')).toBe(false)
    expect(
      update(
        result,
        Message.GotTweetReaderMessage({
          message: Reader.Message.Seen({ slug: 'a', identity: 'anonymous' }),
        }),
      ).model.tweetReader,
    ).toEqual(result.tweetReader)
  })

  it('only accepted successful concrete visits change the checkpoint, including identical revalidation', () => {
    const a = tweetFlags('a')
    const initial = init(a).model
    const hydrated = update(initial, Message.ClientStarted())
    expect(hydrated.model.tweetReader.checkpoint).toBe('a')
    expect(
      update(hydrated.model, changed('https://gbfm.co.za/tweet/latest')).model.tweetReader
        .returnSlug,
    ).toBe('a')

    const withoutCheckpoint = {
      ...hydrated.model,
      tweetReader: { ...hydrated.model.tweetReader, checkpoint: null },
    }

    expect(
      update(withoutCheckpoint, Message.LoadedPage({ flags: a, key: '/tweet/a', navigationId: 0 }))
        .model.tweetReader.checkpoint,
    ).toBe('a')

    for (const status of [404, 503]) {
      const failure = { ...a, status, tweet: null, neighbours: null }
      expect(
        update(
          hydrated.model,
          Message.LoadedPage({ flags: failure, key: '/tweet/a', navigationId: 0 }),
        ).model.tweetReader.checkpoint,
      ).toBe('a')
    }
  })

  it('prefetch never visits or caches personalised navigation, and obsolete loads cannot settle the cache', () => {
    const initial = init(flags).model

    const prefetched = update(
      initial,
      Message.PrefetchedPage({ flags: tweetFlags('a'), key: '/tweet/a' }),
    ).model

    expect(prefetched.tweetReader.checkpoint).toBeNull()

    const cached = Option.getOrThrow(
      AsyncData.getData(Option.getOrThrow(HashMap.get(prefetched.pageCache, '/tweet/a'))),
    )

    expect(cached.neighbours).toBeNull()
    const current = { ...prefetched, navigationId: 4 }
    expect(
      update(
        current,
        Message.LoadedPage({ flags: tweetFlags('b'), key: '/tweet/b', navigationId: 3 }),
      ),
    ).toEqual({ model: current })

    const latePrefetch = update(
      current,
      Message.PrefetchedPage({ flags: tweetFlags('b'), key: '/tweet/b' }),
    ).model

    expect(latePrefetch.flags).toEqual(current.flags)
    expect(latePrefetch.tweetReader).toEqual(current.tweetReader)
  })

  it('entry aliases bypass the cache and reject delayed resume resolutions after another navigation', () => {
    for (const path of ['/tweets', '/tweet', '/tweet/latest']) expect(isCacheable(path)).toBe(false)
    expect(isCacheable('/listening?mix=saved-mix')).toBe(false)
    expect(isCacheable('/tweets?q=search')).toBe(true)

    const initial = {
      ...init(flags).model,
      interactive: true,
      tweetReader: { ...Reader.init('anonymous'), checkpoint: 'a' },
    }

    const entering = update(initial, changed('https://gbfm.co.za/tweets')).model
    expect(entering.loading).toBe(true)
    expect(
      update(
        entering,
        Message.GotTweetReaderMessage({
          message: Reader.Message.EntryResolved({
            slug: 'other-account',
            navigationId: entering.navigationId,
            identity: 'other',
          }),
        }),
      ),
    ).toEqual({ model: entering })
    const departed = update(entering, changed('https://gbfm.co.za/about')).model
    expect(
      update(
        departed,
        Message.GotTweetReaderMessage({
          message: Reader.Message.EntryResolved({
            slug: 'a',
            navigationId: entering.navigationId,
            identity: 'anonymous',
          }),
        }),
      ),
    ).toEqual({ model: departed })
  })

  it('only auto-resume missing clears the checkpoint once; failures and direct missing preserve it', () => {
    const a = tweetFlags('a')

    const model = {
      ...init(a).model,
      loading: true,
      navigationId: 2,
      tweetReader: { ...Reader.init('anonymous'), checkpoint: 'a', resumeSlug: 'a' },
    }

    const missing = { ...a, status: 404, tweet: null, neighbours: null }

    const cachedResume = update(
      { ...model, pageCache: seedCache(a) },
      changed('https://gbfm.co.za/tweet/a'),
    ).model

    expect(cachedResume.loading).toBe(true)
    expect(cachedResume.tweetReader.resumeSlug).toBe('a')

    const fallback = update(
      model,
      Message.LoadedPage({ flags: missing, key: '/tweet/a', navigationId: 2 }),
    )

    expect(fallback.model.tweetReader.checkpoint).toBeNull()
    expect(fallback.model.tweetReader.resumeSlug).toBeNull()

    const direct = update(
      { ...model, tweetReader: { ...model.tweetReader, resumeSlug: null } },
      Message.LoadedPage({ flags: missing, key: '/tweet/a', navigationId: 2 }),
    )

    expect(direct.model.flags.status).toBe(404)
    expect(direct.model.tweetReader.checkpoint).toBe('a')
    expect(
      update(
        model,
        Message.LoadedPage({
          flags: { ...missing, status: 503 },
          key: '/tweet/a',
          navigationId: 2,
        }),
      ).model.tweetReader.checkpoint,
    ).toBe('a')
    expect(
      update(model, Message.FailedPage({ key: '/tweet/a', navigationId: 2 })).model.tweetReader
        .checkpoint,
    ).toBe('a')
  })

  it('does not visit an invalid cached redirect and rejects replies after leaving and returning to the same slug', () => {
    const a = tweetFlags('a')

    const initial = {
      ...init(a).model,
      interactive: true,
      pageCache: HashMap.set(seedCache(a), '/tweet/b', AsyncData.Success({ data: a })),
    }

    const invalid = update(initial, changed('https://gbfm.co.za/tweet/b')).model
    expect(invalid.loading).toBe(true)
    expect(invalid.tweetReader.checkpoint).toBeNull()
    const current = { ...initial, navigationId: 3 }
    expect(update(current, Message.FailedReplies({ slug: 'a', navigationId: 1 }))).toEqual({
      model: current,
    })
    expect(
      update(current, Message.LoadedReplies({ slug: 'a', navigationId: 1, replies: [] })),
    ).toEqual({ model: current })
  })
})

describe('parseRoute', () => {
  it('parses public, creator, dashboard, and missing routes', () => {
    expect(parseRoute('/mixes/42')).toEqual(Route.cases.Detail.make({ kind: 'mixes', slug: '42' }))
    expect(parseRoute('/new/editorial')).toEqual(Route.cases.Composer.make({ kind: 'editorial' }))
    expect(parseRoute('/dashboard/email-logs')).toEqual(
      Route.cases.Dashboard.make({
        section: 'email-logs',
      }),
    )
    expect(parseRoute('/local-creator')).toEqual(
      Route.cases.Detail.make({ kind: 'resolve', slug: 'local-creator' }),
    )
    expect(parseRoute('/definitely/missing/route')).toEqual(Route.cases.NotFound.make({}))
  })

  it('drops creator and dashboard command results from a prior navigation', () => {
    const model = { ...init(flags).model, navigationId: 3 }
    const result = CreatorMessage.AudioUploaded({ url: 'https://cdn.example/previous.mp3' })
    expect(update(model, Message.GotCreatorResult({ message: result, navigationId: 2 }))).toEqual({
      model,
    })
    expect(
      update(model, Message.GotCreatorResult({ message: result, navigationId: 3 })).model.creator
        .draft.audioUrl,
    ).toBe('https://cdn.example/previous.mp3')
    const failure = DashboardMessage.Failed({ message: 'Failure for the old account screen' })
    expect(
      update(model, Message.GotDashboardResult({ message: failure, navigationId: 2 })),
    ).toEqual({ model })
    expect(
      update(model, Message.GotDashboardResult({ message: failure, navigationId: 3 })).model
        .dashboard.error,
    ).toBe('Failure for the old account screen')
  })
})

describe('mobile menu pull gesture', () => {
  const openMenu = () => {
    const model = init(flags).model

    return { ...model, mobileMenu: { ...model.mobileMenu, isOpen: true } }
  }

  it('follows the active pointer downward and snaps short pulls back', () => {
    const started = update(
      openMenu(),
      Message.MenuDragStarted({ pointerId: 1, clientY: 100 }),
    ).model

    const moved = update(started, Message.MenuDragMoved({ pointerId: 1, clientY: 180 })).model
    expect(moved.menuOffset).toBe(80)
    expect(update(moved, Message.MenuDragMoved({ pointerId: 2, clientY: 400 })).model).toBe(moved)

    const released = update(
      moved,
      Message.MenuDragReleased({ pointerId: 1, clientY: 180, viewportHeight: 800 }),
    ).model

    expect(released.menuDrag).toBeNull()
    expect(released.menuOffset).toBe(0)
    expect(released.mobileMenu.isOpen).toBe(true)
  })

  it('closes past the threshold while keeping the release offset for the exit animation', () => {
    const started = update(
      openMenu(),
      Message.MenuDragStarted({ pointerId: 1, clientY: 100 }),
    ).model

    const released = update(
      started,
      Message.MenuDragReleased({ pointerId: 1, clientY: 270, viewportHeight: 800 }),
    ).model

    expect(released.mobileMenu.isOpen).toBe(false)
    expect(released.menuOffset).toBe(170)
    expect(released.menuDrag).toBeNull()
  })

  it('ignores drags while the menu is closed', () => {
    const closed = init(flags).model
    expect(update(closed, Message.MenuDragStarted({ pointerId: 1, clientY: 100 })).model).toBe(
      closed,
    )
  })
})
