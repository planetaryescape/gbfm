import type { QueueTrackType } from '@gbfm/player'
import { Option, Predicate } from 'effect'
import * as Scene from 'foldkit/scene'
import { fromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'

import { init } from './init'
import { Message } from './message'
import type { Flags, Model, Principal } from './model'
import * as PlayerModule from './player'
import * as PublicActionsModule from './public-actions'
import { update } from './update'

// Server observations/acknowledgements used by the existing journey fixtures.
const Player = {
  ...PlayerModule,
  Favorite: {
    ...PlayerModule.Favorite,
    Message: {
      ...PlayerModule.Favorite.Message,
      Loaded: (
        input: Omit<Parameters<typeof PlayerModule.Favorite.Message.Loaded>[0], 'revision'> & {
          revision?: number | null
        },
      ) => PlayerModule.Favorite.Message.Loaded({ revision: 17, ...input }),
      Saved: (
        input: Omit<Parameters<typeof PlayerModule.Favorite.Message.Saved>[0], 'revision'> & {
          revision?: number
        },
      ) => PlayerModule.Favorite.Message.Saved({ revision: 18, ...input }),
      SaveFailed: (
        input: Omit<
          Parameters<typeof PlayerModule.Favorite.Message.SaveFailed>[0],
          'conflicted' | 'mutationId'
        >,
      ) =>
        PlayerModule.Favorite.Message.SaveFailed({
          conflicted: false,
          mutationId: 'da5495ab-6f07-4a4f-bb5e-0f9355e71e40',
          ...input,
        }),
    },
  },
}

const PublicActions = {
  ...PublicActionsModule,
  Message: {
    ...PublicActionsModule.Message,
    Saved: (
      input: Omit<Parameters<typeof PublicActionsModule.Message.Saved>[0], 'revision'> & {
        revision?: number
      },
    ) => PublicActionsModule.Message.Saved({ revision: 18, ...input }),
    Failed: (
      input: Omit<
        Parameters<typeof PublicActionsModule.Message.Failed>[0],
        'conflicted' | 'mutationId'
      >,
    ) =>
      PublicActionsModule.Message.Failed({
        conflicted: false,
        mutationId: 'da5495ab-6f07-4a4f-bb5e-0f9355e71e40',
        ...input,
      }),
  },
}

const listener: Principal = { id: 'user-1', name: 'Listener', username: null, role: 'user' }

const track: QueueTrackType = {
  id: 'mix-a',
  title: 'Local Frequencies',
  slug: 'local-frequencies',
  url: 'https://cdn.test/mix-a.mp3',
  thumbnailUrl: null,
  type: 'mix',
}

const page = (
  path: string,
  principal: Principal | null,
  publicAction: Flags['publicAction'] = null,
): Flags => ({
  url: `https://gbfm.co.za${path}`,
  status: 200,
  principal,
  items: [],
  title: path,
  description: '',
  requestId: path,
  renderedAt: 0,
  skipSeen: false,
  tweet: null,
  neighbours: null,
  dashboard: null,
  profile: null,
  shows: null,
  changelog: null,
  publicAction,
  metadata: null,
  failure: null,
})

const mixPage = (state: 'active' | 'inactive', principal: Principal | null = listener) =>
  page('/mixes/local-frequencies', principal, {
    target: { id: 'mix-a', kind: 'audio' },
    path: '/mixes/local-frequencies',
    state,
  })

const observePage = (model: Model, active: boolean, revision: number) => {
  const action = model.publicAction

  if (!action.document || !action.principalId || action.revision !== null || !action.busy)
    return model

  return update(
    model,
    Message.GotPublicActionMessage({
      message: PublicActions.Message.Loaded({
        target: action.document.target,
        principalId: action.principalId,
        requestId: action.requestId,
        active,
        revision,
      }),
    }),
  ).model
}

const send = (model: Model, message: Message) => {
  const result = update(model, message)

  return Predicate.isTagged(message, 'LoadedPage') &&
    message.flags.principal?.id === result.model.publicAction.principalId
    ? {
        ...result,
        model: observePage(result.model, message.flags.publicAction?.state === 'active', 29),
      }
    : result
}

const player = (model: Model, message: PlayerModule.Message) =>
  send(model, Message.GotPlayerMessage({ message }))

const favorite = (model: Model, message: PlayerModule.Favorite.Message) =>
  player(model, Player.Message.GotFavoriteMessage({ message }))

const playing = (flags: Flags) => {
  const started = observePage(
    send(init(flags).model, Message.ClientStarted()).model,
    flags.publicAction?.state === 'active',
    17,
  )

  const snapshot = {
    ...started.player.snapshot,
    queue: { tracks: [track], currentIndex: 0, current: track },
  }

  return player(started, Player.Message.SnapshotChanged({ snapshot }))
}

const settled = (flags: Flags, state: 'active' | 'inactive') => {
  const model = playing(flags).model

  return favorite(
    model,
    Player.Favorite.Message.Loaded({
      generation: model.player.favorite.generation,
      state,
      principalId: flags.principal?.id ?? null,
      principalKnown: true,
    }),
  ).model
}

const changed = (href: string) => Message.ChangedUrl({ url: Option.getOrThrow(fromString(href)) })

const commandNames = (result: { commands?: ReadonlyArray<{ name: string }> }) =>
  (result.commands ?? []).map(({ name }) => name)

const savePlayerFavorite = (model: Model, active: boolean) => {
  const saving = favorite(model, Player.Favorite.Message.Toggled()).model

  expect(saving.player.favorite.saving).toBe(true)
  const principalId = saving.player.favorite.principalId

  if (!principalId) throw new Error('Expected an authenticated favorite save')

  return favorite(
    saving,
    Player.Favorite.Message.Saved({
      generation: saving.player.favorite.generation,
      audioId: 'mix-a',
      active,
      principalId,
    }),
  ).model
}

const loadMixPage = (model: Model, flags: Flags = mixPage('inactive')) =>
  send(
    model,
    Message.LoadedPage({
      flags,
      key: '/mixes/local-frequencies',
      navigationId: model.navigationId,
    }),
  )

const changeTrack = (model: Model, current: QueueTrackType) =>
  player(
    model,
    Player.Message.SnapshotChanged({
      snapshot: {
        ...model.player.snapshot,
        queue: { tracks: [current], currentIndex: 0, current },
      },
    }),
  ).model

describe('player favorite integration', () => {
  it('loads an atomic observation on init and navigation before allowing a page write', () => {
    const initial = init(mixPage('inactive'))
    expect(initial.model.publicAction).toMatchObject({ busy: true, revision: null })
    const first = initial.commands?.find(({ name }) => name === 'PublicActions.Load')
    expect(first?.args).toMatchObject({
      principalId: listener.id,
      requestId: initial.model.publicAction.requestId,
    })
    expect(
      commandNames(
        update(
          initial.model,
          Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
        ),
      ),
    ).not.toContain('PublicActions.Save')
    const ready = observePage(initial.model, false, 71)

    const pageControl = {
      update,
      view: (model: Model, h: Parameters<typeof PublicActionsModule.view<Message>>[1]) =>
        PublicActionsModule.view(
          model.publicAction,
          h,
          (message) => Message.GotPublicActionMessage({ message }),
          true,
        ),
    }

    Scene.scene(
      pageControl,
      Scene.given(initial.model),
      Scene.expect(Scene.role('button', { name: 'Checking…' })).toBeDisabled(),
    )
    Scene.scene(
      pageControl,
      Scene.given(ready),
      Scene.expect(Scene.role('button', { name: 'Add to favorites' })).toBeEnabled(),
      Scene.expect(Scene.role('button')).toHaveAttr('aria-pressed', 'false'),
    )

    expect(
      update(ready, Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }))
        .commands?.[0]?.args,
    ).toMatchObject({ expectedRevision: 71 })

    const away = update(ready, changed('https://gbfm.co.za/about')).model

    // An ordinary destination with no action cannot inherit the previous page's revision.
    const about = update(
      away,
      Message.LoadedPage({
        flags: page('/about', listener),
        key: '/about',
        navigationId: away.navigationId,
      }),
    ).model

    const returning = update(about, changed('https://gbfm.co.za/mixes/local-frequencies'))

    const navigation = update(
      returning.model,
      Message.LoadedPage({
        flags: mixPage('inactive'),
        key: '/mixes/local-frequencies',
        navigationId: returning.model.navigationId,
      }),
    )

    expect(navigation.model.publicAction).toMatchObject({ busy: true, revision: null })

    const observedCommands = [...(returning.commands ?? []), ...(navigation.commands ?? [])].filter(
      ({ name }) => name === 'PublicActions.Load',
    )

    expect(observedCommands).toHaveLength(1)
    expect(observedCommands[0]?.args).toMatchObject({
      requestId: navigation.model.publicAction.requestId,
    })
    expect(commandNames(init(mixPage('inactive', null)))).not.toContain('PublicActions.Load')
  })

  it('propagates the actual acknowledged revision both ways, never only the membership boolean', () => {
    const root = settled(mixPage('inactive'), 'inactive')

    const ready = observePage(
      { ...root, publicAction: { ...root.publicAction, busy: true, revision: null } },
      false,
      82,
    )

    const pending = update(
      ready,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    const saved = update(
      pending,
      Message.GotPublicActionMessage({
        message: PublicActionsModule.Message.Saved({
          target: { id: 'mix-a', kind: 'audio' },
          active: true,
          principalId: listener.id,
          requestId: pending.publicAction.requestId,
          revision: 83,
        }),
      }),
    ).model

    expect(saved.player.favorite).toMatchObject({ status: 'active', revision: 83 })
    const playerWrite = favorite(saved, Player.Favorite.Message.Toggled())
    expect(playerWrite.commands?.[0]?.args).toMatchObject({ expectedRevision: 83, active: false })

    const acknowledged = favorite(
      playerWrite.model,
      Player.Favorite.Message.Saved({
        generation: playerWrite.model.player.favorite.generation,
        audioId: 'mix-a',
        active: false,
        principalId: listener.id,
        revision: 84,
      }),
    ).model

    expect(acknowledged.publicAction).toMatchObject({
      revision: 84,
      document: { state: 'inactive' },
    })
    expect(acknowledged.navigationFavoriteChanges).toEqual([
      { audioId: 'mix-a', active: false, principalId: listener.id, revision: 84 },
    ])
    expect(
      update(
        acknowledged,
        Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
      ).commands?.[0]?.args,
    ).toMatchObject({ expectedRevision: 84 })
  })

  it('retains an uncertain page intent across navigation and an acknowledgement from the other control', () => {
    const ready = settled(mixPage('inactive'), 'inactive')

    const saving = update(
      ready,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    const mutationId = '029373a7-980e-4a18-a5ba-0063f2834ae4'

    const failed = update(
      saving,
      Message.GotPublicActionMessage({
        message: PublicActionsModule.Message.Failed({
          target: { id: 'mix-a', kind: 'audio' },
          principalId: listener.id,
          requestId: saving.publicAction.requestId,
          unauthorized: false,
          conflicted: false,
          mutationId,
        }),
      }),
    ).model

    const playerPending = favorite(failed, Player.Favorite.Message.Toggled()).model

    const acknowledged = favorite(
      playerPending,
      Player.Favorite.Message.Saved({
        generation: playerPending.player.favorite.generation,
        audioId: 'mix-a',
        active: true,
        principalId: listener.id,
        revision: 18,
      }),
    ).model

    expect(acknowledged.publicAction).toMatchObject({
      mutationId,
      revision: 17,
      document: { state: 'inactive' },
    })

    const leaving = update(
      acknowledged,
      changed('https://gbfm.co.za/mixes/local-frequencies'),
    ).model

    const returned = update(
      leaving,
      Message.LoadedPage({
        flags: { ...mixPage('inactive'), description: 'Changed content' },
        key: '/mixes/local-frequencies',
        navigationId: leaving.navigationId,
      }),
    )

    expect(returned.model.publicAction).toBe(acknowledged.publicAction)
    expect(commandNames(returned)).not.toContain('PublicActions.Load')

    const retry = update(
      returned.model,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    )

    expect(retry.commands?.[0]?.args).toMatchObject({
      mutationId,
      expectedRevision: 17,
      active: true,
    })
  })

  it('does not replace an uncertain player retry with a page observation', () => {
    const ready = settled(mixPage('inactive'), 'inactive')
    const saving = favorite(ready, Player.Favorite.Message.Toggled()).model

    const failed = favorite(
      saving,
      Player.Favorite.Message.SaveFailed({
        generation: saving.player.favorite.generation,
        unauthorized: false,
        principalId: listener.id,
      }),
    ).model

    const observed = observePage(
      { ...failed, publicAction: { ...failed.publicAction, busy: true, revision: null } },
      true,
      92,
    )

    expect(observed.player.favorite).toMatchObject({
      revision: 17,
      mutationId: 'da5495ab-6f07-4a4f-bb5e-0f9355e71e40',
      status: 'inactive',
    })
    expect(favorite(observed, Player.Favorite.Message.Toggled()).commands?.[0]?.args).toMatchObject(
      { expectedRevision: 17, mutationId: 'da5495ab-6f07-4a4f-bb5e-0f9355e71e40' },
    )
  })

  it('starts a new owner-bound page observation on API-confirmed identity change and ignores the old one', () => {
    const initial = playing(mixPage('inactive')).model
    const previousRequest = initial.publicAction.requestId

    const confirmed = favorite(
      initial,
      Player.Favorite.Message.Loaded({
        generation: initial.player.favorite.generation,
        state: 'inactive',
        principalId: 'user-2',
        principalKnown: true,
        revision: 103,
      }),
    )

    expect(confirmed.model.publicAction).toMatchObject({
      principalId: 'user-2',
      busy: true,
      revision: null,
      mutationId: null,
    })
    expect(
      confirmed.commands?.find(({ name }) => name === 'PublicActions.Load')?.args,
    ).toMatchObject({ principalId: 'user-2', requestId: confirmed.model.publicAction.requestId })
    expect(confirmed.model.publicAction.requestId).toBeGreaterThan(previousRequest)

    const late = update(
      confirmed.model,
      Message.GotPublicActionMessage({
        message: PublicActions.Message.Loaded({
          target: { id: 'mix-a', kind: 'audio' },
          principalId: listener.id,
          requestId: previousRequest,
          active: true,
          revision: 19,
        }),
      }),
    ).model

    expect(late.publicAction).toBe(confirmed.model.publicAction)
    const observed = observePage(late, false, 103)
    expect(observed.publicAction).toMatchObject({
      revision: 103,
      busy: false,
      document: { state: 'inactive' },
    })
  })

  it.each([false, true])(
    'preserves a pending page save across same-audio navigation before its acknowledgement, changed content: %s',
    (changedContent) => {
      const inactive = settled(mixPage('inactive'), 'inactive')

      const pending = send(
        inactive,
        Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
      ).model

      const navigation = send(pending, changed('https://gbfm.co.za/mixes/local-frequencies')).model

      const flags = changedContent
        ? { ...mixPage('inactive'), description: 'Updated server content' }
        : mixPage('inactive')

      const loaded = loadMixPage(navigation, flags).model

      const saved = send(
        loaded,
        Message.GotPublicActionMessage({
          message: PublicActions.Message.Saved({
            target: { id: 'mix-a', kind: 'audio' },
            principalId: listener.id,
            requestId: pending.publicAction.requestId,
            active: true,
          }),
        }),
      ).model

      expect(navigation.publicAction).toEqual(pending.publicAction)
      expect(loaded.publicAction).toEqual(pending.publicAction)
      expect(loaded.player.favorite.status).toBe('inactive')
      expect(saved.publicAction).toMatchObject({ busy: false, document: { state: 'active' } })
      expect(saved.player.favorite.status).toBe('active')

      const later = send(saved, changed('https://gbfm.co.za/mixes/local-frequencies')).model
      const externalRemoval = loadMixPage(later).model

      expect(externalRemoval.publicAction.document?.state).toBe('inactive')
      expect(externalRemoval.player.favorite.status).toBe('inactive')
    },
  )

  it('preserves the newest same-account pending request without accepting a superseded acknowledgement', () => {
    const inactive = settled(mixPage('inactive'), 'inactive')

    const first = send(
      inactive,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    const failed = send(
      first,
      Message.GotPublicActionMessage({
        message: PublicActions.Message.Failed({
          target: { id: 'mix-a', kind: 'audio' },
          principalId: listener.id,
          requestId: first.publicAction.requestId,
          unauthorized: false,
        }),
      }),
    ).model

    const second = send(
      failed,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    const navigation = send(second, changed('https://gbfm.co.za/mixes/local-frequencies')).model
    const loaded = loadMixPage(navigation).model

    const obsolete = send(
      loaded,
      Message.GotPublicActionMessage({
        message: PublicActions.Message.Saved({
          target: { id: 'mix-a', kind: 'audio' },
          principalId: listener.id,
          requestId: first.publicAction.requestId,
          active: true,
        }),
      }),
    ).model

    const saved = send(
      obsolete,
      Message.GotPublicActionMessage({
        message: PublicActions.Message.Saved({
          target: { id: 'mix-a', kind: 'audio' },
          principalId: listener.id,
          requestId: second.publicAction.requestId,
          active: true,
        }),
      }),
    ).model

    expect(obsolete.publicAction).toEqual(second.publicAction)
    expect(obsolete.player.favorite.status).toBe('inactive')
    expect(obsolete.navigationFavoriteChanges).toEqual([])
    expect(saved.publicAction).toMatchObject({ busy: false, document: { state: 'active' } })
    expect(saved.player.favorite.status).toBe('active')
  })

  it.each<PublicActionsModule.Document['target']>([
    { kind: 'audio', id: 'mix-b' },
    { kind: 'show', id: 'mix-a' },
  ])('invalidates a pending page save when the target changes to $kind/$id', (target) => {
    const inactive = settled(mixPage('inactive'), 'inactive')

    const pending = send(
      inactive,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    const navigation = send(pending, changed('https://gbfm.co.za/other-target')).model

    const loaded = send(
      navigation,
      Message.LoadedPage({
        flags: page('/other-target', listener, {
          target,
          path: '/other-target',
          state: 'inactive',
        }),
        key: '/other-target',
        navigationId: navigation.navigationId,
      }),
    ).model

    const current = send(
      loaded,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    const obsolete = send(
      current,
      Message.GotPublicActionMessage({
        message: PublicActions.Message.Saved({
          target: { kind: 'audio', id: 'mix-a' },
          principalId: listener.id,
          requestId: pending.publicAction.requestId,
          active: true,
        }),
      }),
    ).model

    expect(loaded.publicAction).toMatchObject({
      busy: false,
      document: { target, state: 'inactive' },
    })
    expect(current.publicAction.busy).toBe(true)
    expect(obsolete.publicAction).toEqual(current.publicAction)
    expect(obsolete.player.favorite.status).toBe('inactive')
    expect(obsolete.navigationFavoriteChanges).toEqual([])
  })

  it('preserves an API-recovered account and its acknowledged save when page identity was unknown', () => {
    const loading = playing(page('/about', null)).model

    const recovered = favorite(
      loading,
      Player.Favorite.Message.Loaded({
        generation: loading.player.favorite.generation,
        state: 'inactive',
        principalId: listener.id,
        principalKnown: true,
      }),
    ).model

    expect(recovered.player.favorite.principalId).toBe(listener.id)
    const navigation = send(recovered, changed('https://gbfm.co.za/mixes/local-frequencies')).model

    expect(navigation.player.favorite.principalId).toBe(listener.id)
    const saved = savePlayerFavorite(navigation, true)
    const loaded = loadMixPage(saved).model

    expect(loaded.publicAction.document?.state).toBe('active')
    expect(loaded.player.favorite).toMatchObject({ principalId: listener.id, status: 'active' })

    const later = send(loaded, changed('https://gbfm.co.za/mixes/local-frequencies')).model
    const externalRemoval = loadMixPage(later).model

    expect(externalRemoval.publicAction.document?.state).toBe('inactive')
    expect(externalRemoval.player.favorite).toMatchObject({
      principalId: listener.id,
      status: 'inactive',
    })
  })

  it('rejects account A page acknowledgements after account B loads the same audio', () => {
    const inactive = settled(mixPage('inactive'), 'inactive')

    const pending = send(
      inactive,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    const leaving = send(pending, changed('https://gbfm.co.za/mixes/local-frequencies')).model
    const switched = loadMixPage(leaving, mixPage('inactive', { ...listener, id: 'user-2' })).model

    const late = send(
      switched,
      Message.GotPublicActionMessage({
        message: PublicActions.Message.Saved({
          target: { id: 'mix-a', kind: 'audio' },
          active: true,
          principalId: listener.id,
          requestId: pending.publicAction.requestId,
        }),
      }),
    ).model

    expect(late.publicAction.document?.state).toBe('inactive')
    expect(late.player.favorite).toMatchObject({ principalId: 'user-2', status: 'inactive' })
    expect(late.navigationFavoriteChanges).toEqual([])

    const cached = send(late, changed('https://gbfm.co.za/mixes/local-frequencies')).model
    const restarted = send(cached, Message.ClientStarted()).model

    expect(restarted.player.favorite).toMatchObject({ principalId: 'user-2', status: 'inactive' })
    expect(restarted.publicAction).toMatchObject({
      busy: false,
      document: { state: 'inactive' },
    })
  })

  it.each(['Saved', 'Failed'])(
    'does not let an old page %s settle a different account request or a later same-account request',
    (result) => {
      const inactive = settled(mixPage('inactive'), 'inactive')

      const pendingA = send(
        inactive,
        Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
      ).model

      const leavingA = send(pendingA, changed('https://gbfm.co.za/mixes/local-frequencies')).model

      const accountB = loadMixPage(
        leavingA,
        mixPage('inactive', { ...listener, id: 'user-2' }),
      ).model

      const pendingB = send(
        accountB,
        Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
      ).model

      const oldResult =
        result === 'Saved'
          ? PublicActions.Message.Saved({
              target: { id: 'mix-a', kind: 'audio' },
              active: true,
              principalId: listener.id,
              requestId: pendingA.publicAction.requestId,
            })
          : PublicActions.Message.Failed({
              target: { id: 'mix-a', kind: 'audio' },
              unauthorized: true,
              principalId: listener.id,
              requestId: pendingA.publicAction.requestId,
            })

      const lateA = send(pendingB, Message.GotPublicActionMessage({ message: oldResult })).model

      expect(lateA.publicAction).toEqual(pendingB.publicAction)
      expect(lateA.player.favorite).toEqual(pendingB.player.favorite)
      expect(lateA.navigationFavoriteChanges).toEqual([])

      const savedB = send(
        lateA,
        Message.GotPublicActionMessage({
          message: PublicActions.Message.Saved({
            target: { id: 'mix-a', kind: 'audio' },
            active: true,
            principalId: 'user-2',
            requestId: pendingB.publicAction.requestId,
          }),
        }),
      ).model

      expect(savedB.publicAction).toMatchObject({ busy: false, document: { state: 'active' } })
      expect(savedB.player.favorite).toMatchObject({ principalId: 'user-2', status: 'active' })
      expect(savedB.navigationFavoriteChanges).toEqual([
        { principalId: 'user-2', audioId: 'mix-a', active: true, revision: 18 },
      ])

      const leavingB = send(savedB, changed('https://gbfm.co.za/mixes/local-frequencies')).model

      const external = loadMixPage(
        leavingB,
        mixPage('inactive', { ...listener, id: 'user-2' }),
      ).model

      expect(external.publicAction.document?.state).toBe('inactive')
      expect(external.player.favorite.status).toBe('inactive')

      const returningA = send(external, changed('https://gbfm.co.za/mixes/local-frequencies')).model
      const accountA = loadMixPage(returningA).model

      const newA = send(
        accountA,
        Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
      ).model

      const obsolete = send(newA, Message.GotPublicActionMessage({ message: oldResult })).model

      expect(newA.publicAction.busy).toBe(true)
      expect(obsolete.publicAction).toEqual(newA.publicAction)
      expect(obsolete.player.favorite).toEqual(newA.player.favorite)
      expect(obsolete.navigationFavoriteChanges).toEqual([])
    },
  )

  it('retains independently confirmed identity across unknown pages but honors confirmed sign-out', () => {
    const inactive = settled(mixPage('inactive'), 'inactive')
    const leaving = send(inactive, changed('https://gbfm.co.za/about')).model

    const unknown = send(
      leaving,
      Message.LoadedPage({
        flags: { ...page('/about', null), principalKnown: false },
        key: '/about',
        navigationId: leaving.navigationId,
      }),
    ).model

    expect(unknown.player.favorite).toMatchObject({ principalId: listener.id, status: 'inactive' })

    const next = send(unknown, changed('https://gbfm.co.za/about')).model

    const signedOut = send(
      next,
      Message.LoadedPage({
        flags: { ...page('/about', null), principalKnown: true },
        key: '/about',
        navigationId: next.navigationId,
      }),
    ).model

    const obsolete = favorite(
      signedOut,
      Player.Favorite.Message.Loaded({
        generation: inactive.player.favorite.generation,
        state: 'active',
        principalId: listener.id,
        principalKnown: true,
      }),
    ).model

    expect(signedOut.player.favorite).toMatchObject({ principalId: null, status: 'loading' })
    expect(obsolete.player.favorite).toEqual(signedOut.player.favorite)
  })

  it('ignores obsolete player loads and save failures while the next account is loading', () => {
    const inactive = settled(mixPage('inactive'), 'inactive')
    const saving = favorite(inactive, Player.Favorite.Message.Toggled()).model
    const leaving = send(saving, changed('https://gbfm.co.za/about')).model

    const switched = send(
      leaving,
      Message.LoadedPage({
        flags: page('/about', { ...listener, id: 'user-2' }),
        key: '/about',
        navigationId: leaving.navigationId,
      }),
    ).model

    expect(switched.player.favorite).toMatchObject({
      principalId: 'user-2',
      status: 'loading',
      saving: false,
    })

    const oldLoad = favorite(
      switched,
      Player.Favorite.Message.Loaded({
        generation: saving.player.favorite.generation,
        state: 'active',
        principalId: listener.id,
        principalKnown: true,
      }),
    ).model

    const oldFailure = favorite(
      oldLoad,
      Player.Favorite.Message.SaveFailed({
        generation: saving.player.favorite.generation,
        principalId: listener.id,
        unauthorized: true,
      }),
    ).model

    expect(oldFailure.player.favorite).toEqual(switched.player.favorite)
    expect(oldFailure.navigationFavoriteChanges).toEqual([])

    const current = favorite(
      oldFailure,
      Player.Favorite.Message.Loaded({
        generation: switched.player.favorite.generation,
        state: 'inactive',
        principalId: 'user-2',
        principalKnown: true,
      }),
    ).model

    expect(current.player.favorite).toMatchObject({
      principalId: 'user-2',
      status: 'inactive',
      saving: false,
    })
  })

  it('invalidates an in-flight page save when the player API independently confirms another account', () => {
    const initial = playing(mixPage('inactive')).model

    const pending = send(
      initial,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    const confirmed = favorite(
      pending,
      Player.Favorite.Message.Loaded({
        generation: pending.player.favorite.generation,
        state: 'inactive',
        principalId: 'user-2',
        principalKnown: true,
      }),
    ).model

    const late = send(
      confirmed,
      Message.GotPublicActionMessage({
        message: PublicActions.Message.Failed({
          target: { id: 'mix-a', kind: 'audio' },
          unauthorized: true,
          principalId: listener.id,
          requestId: pending.publicAction.requestId,
        }),
      }),
    ).model

    expect(confirmed.publicAction).toMatchObject({
      busy: true,
      revision: null,
      document: { state: 'unavailable' },
    })
    expect(late.publicAction).toEqual(confirmed.publicAction)
    expect(late.player.favorite).toMatchObject({ principalId: 'user-2', status: 'inactive' })
    expect(late.navigationFavoriteChanges).toEqual([])

    const cached = send(late, changed('https://gbfm.co.za/mixes/local-frequencies')).model
    const restarted = send(cached, Message.ClientStarted()).model

    expect(restarted.player.favorite).toMatchObject({ principalId: 'user-2', status: 'inactive' })
    expect(restarted.publicAction).toMatchObject({
      busy: true,
      document: { state: 'unavailable' },
    })
  })

  it('invalidates an unknown-account load when a newer page confirms signed-out identity', () => {
    const unknown = playing(page('/about', null)).model
    const navigation = send(unknown, changed('https://gbfm.co.za/about')).model

    const signedOut = send(
      navigation,
      Message.LoadedPage({
        flags: { ...page('/about', null), principalKnown: true },
        key: '/about',
        navigationId: navigation.navigationId,
      }),
    ).model

    const obsolete = favorite(
      signedOut,
      Player.Favorite.Message.Loaded({
        generation: unknown.player.favorite.generation,
        state: 'active',
        principalId: listener.id,
        principalKnown: true,
      }),
    ).model

    expect(signedOut.player.favorite).toMatchObject({
      principalId: null,
      principalKnown: true,
      status: 'loading',
    })
    expect(signedOut.player.favorite.generation).toBeGreaterThan(unknown.player.favorite.generation)
    expect(obsolete.player.favorite).toEqual(signedOut.player.favorite)
  })

  it('honors a current page request authorization failure and invalidates older player reads', () => {
    const initial = playing(mixPage('inactive')).model

    const pending = send(
      initial,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    const failed = send(
      pending,
      Message.GotPublicActionMessage({
        message: PublicActions.Message.Failed({
          target: { id: 'mix-a', kind: 'audio' },
          unauthorized: true,
          principalId: listener.id,
          requestId: pending.publicAction.requestId,
        }),
      }),
    ).model

    const obsolete = favorite(
      failed,
      Player.Favorite.Message.Loaded({
        generation: initial.player.favorite.generation,
        state: 'active',
        principalId: listener.id,
        principalKnown: true,
      }),
    ).model

    expect(failed.publicAction).toMatchObject({
      principalId: null,
      busy: false,
      document: { state: 'anonymous' },
    })
    expect(failed.player.favorite).toMatchObject({
      principalId: null,
      principalKnown: true,
      status: 'loading',
    })
    expect(obsolete.player.favorite).toEqual(failed.player.favorite)
    expect(obsolete.navigationFavoriteChanges).toEqual([])
  })

  it.each(['previous account', 'signed-out'])(
    'does not adopt an older %s page identity after the player confirms another account',
    (identity) => {
      const initial = playing(page('/about', null)).model
      const navigation = send(initial, changed('https://gbfm.co.za/mixes/local-frequencies')).model

      const confirmed = favorite(
        navigation,
        Player.Favorite.Message.Loaded({
          generation: navigation.player.favorite.generation,
          state: 'inactive',
          principalId: 'user-2',
          principalKnown: true,
        }),
      ).model

      const saved = savePlayerFavorite(confirmed, true)

      const oldFlags =
        identity === 'previous account'
          ? mixPage('inactive')
          : {
              ...page('/mixes/local-frequencies', null, {
                target: { id: 'mix-a', kind: 'audio' },
                path: '/mixes/local-frequencies',
                state: 'anonymous',
              }),
              principalKnown: true,
            }

      const stale = loadMixPage(saved, oldFlags).model

      expect(stale.publicAction).toMatchObject({
        busy: true,
        revision: null,
        document: { state: 'unavailable' },
      })
      expect(stale.player.favorite).toMatchObject({ principalId: 'user-2', status: 'active' })

      const later = send(stale, changed('https://gbfm.co.za/mixes/local-frequencies')).model

      const externalRemoval = loadMixPage(
        later,
        mixPage('inactive', { ...listener, id: 'user-2' }),
      ).model

      expect(externalRemoval.publicAction.document?.state).toBe('inactive')
      expect(externalRemoval.player.favorite).toMatchObject({
        principalId: 'user-2',
        status: 'inactive',
      })
    },
  )

  it('loads the queued track favorite regardless of the browsed page', () => {
    const result = playing(page('/about', listener))

    expect(result.model.player.favorite).toMatchObject({
      status: 'loading',
      principalId: 'user-1',
      track: { audioId: 'mix-a', slug: 'local-frequencies' },
    })
    expect(commandNames(result)).toContain('PlayerFavorite.Load')
  })

  it('keeps favorite state across navigation and reloads it for a different account', () => {
    const active = settled(page('/about', listener), 'active')
    const leaving = send(active, changed('https://gbfm.co.za/shows'))

    const shows = send(
      leaving.model,
      Message.LoadedPage({
        flags: page('/shows', listener),
        key: '/shows',
        navigationId: leaving.model.navigationId,
      }),
    )

    expect(shows.model.player.favorite.status).toBe('active')

    const otherAccount = send(
      shows.model,
      Message.LoadedPage({
        flags: page('/about', { ...listener, id: 'user-2' }),
        key: '/about',
        navigationId: shows.model.navigationId,
      }),
    )

    expect(otherAccount.model.player.favorite).toMatchObject({
      status: 'loading',
      principalId: 'user-2',
    })
    expect(commandNames(otherAccount)).toContain('PlayerFavorite.Load')

    const signingOut = send(otherAccount.model, changed('https://gbfm.co.za/about')).model

    const signedOut = send(
      signingOut,
      Message.LoadedPage({
        flags: { ...page('/about', null), principalKnown: true },
        key: '/about',
        navigationId: signingOut.navigationId,
      }),
    )

    expect(signedOut.model.player.favorite).toMatchObject({ status: 'loading', principalId: null })
  })

  it('applies a page favorite save to the player heart for the same audio', () => {
    const inactive = settled(mixPage('inactive'), 'inactive')

    const pending = send(
      inactive,
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    const saved = send(
      pending,
      Message.GotPublicActionMessage({
        message: PublicActions.Message.Saved({
          target: { id: 'mix-a', kind: 'audio' },
          active: true,
          principalId: listener.id,
          requestId: pending.publicAction.requestId,
        }),
      }),
    ).model

    expect(saved.publicAction.document?.state).toBe('active')
    expect(saved.player.favorite.status).toBe('active')
  })

  it('applies an acknowledged player save to the page control, and only after acknowledgement', () => {
    const inactive = settled(mixPage('inactive'), 'inactive')
    const saving = favorite(inactive, Player.Favorite.Message.Toggled())

    expect(saving.model.publicAction.document?.state).toBe('inactive')
    expect(commandNames(saving)).toEqual(['PlayerFavorite.Save'])

    const saved = favorite(
      saving.model,
      Player.Favorite.Message.Saved({
        generation: saving.model.player.favorite.generation,
        audioId: 'mix-a',
        active: true,
        principalId: listener.id,
      }),
    ).model

    expect(saved.player.favorite.status).toBe('active')
    expect(saved.publicAction.document?.state).toBe('active')
  })

  it('does not restore stale cached page state over a newer player save', () => {
    const inactive = settled(mixPage('inactive'), 'inactive')
    const away = send(inactive, changed('https://gbfm.co.za/about')).model

    const about = send(
      away,
      Message.LoadedPage({
        flags: page('/about', listener),
        key: '/about',
        navigationId: away.navigationId,
      }),
    ).model

    const saving = favorite(about, Player.Favorite.Message.Toggled()).model

    const saved = favorite(
      saving,
      Player.Favorite.Message.Saved({
        generation: saving.player.favorite.generation,
        audioId: 'mix-a',
        active: true,
        principalId: listener.id,
      }),
    ).model

    const back = send(saved, changed('https://gbfm.co.za/mixes/local-frequencies')).model

    expect(back.publicAction.document?.state).toBe('active')
    expect(back.player.favorite.status).toBe('active')
  })

  it('adopts freshly loaded page state into the player heart', () => {
    const active = settled(page('/about', listener), 'active')
    const leaving = send(active, changed('https://gbfm.co.za/mixes/local-frequencies')).model

    const loaded = send(
      leaving,
      Message.LoadedPage({
        flags: mixPage('inactive'),
        key: '/mixes/local-frequencies',
        navigationId: leaving.navigationId,
      }),
    ).model

    expect(loaded.publicAction.document?.state).toBe('inactive')
    expect(loaded.player.favorite.status).toBe('inactive')
  })

  it('does not let a current-navigation page read undo an acknowledged player save', () => {
    const inactive = settled(page('/about', listener), 'inactive')
    const navigation = send(inactive, changed('https://gbfm.co.za/mixes/local-frequencies'))

    expect(commandNames(navigation)).toContain('Navigation.Load')

    const saving = favorite(navigation.model, Player.Favorite.Message.Toggled()).model

    const saved = favorite(
      saving,
      Player.Favorite.Message.Saved({
        generation: saving.player.favorite.generation,
        audioId: 'mix-a',
        active: true,
        principalId: listener.id,
      }),
    ).model

    expect(saved.player.favorite.status).toBe('active')

    const loaded = send(
      saved,
      Message.LoadedPage({
        flags: mixPage('inactive'),
        key: '/mixes/local-frequencies',
        navigationId: navigation.model.navigationId,
      }),
    ).model

    expect(loaded.publicAction.document?.state).toBe('active')
    expect(loaded.player.favorite.status).toBe('active')
  })

  it('adopts newer server state from a subsequent request, even when its flags match the cache', () => {
    const inactive = settled(page('/about', listener), 'inactive')
    const navigation = send(inactive, changed('https://gbfm.co.za/mixes/local-frequencies')).model
    const saved = savePlayerFavorite(navigation, true)
    const stale = loadMixPage(saved).model

    expect(stale.publicAction.document?.state).toBe('active')

    const revalidating = send(stale, changed('https://gbfm.co.za/mixes/local-frequencies'))

    expect(commandNames(revalidating)).toContain('Navigation.Load')
    expect(revalidating.model.publicAction.document?.state).toBe('active')

    const externalRemoval = loadMixPage(revalidating.model).model

    expect(externalRemoval.publicAction.document?.state).toBe('inactive')
    expect(externalRemoval.player.favorite.status).toBe('inactive')
  })

  it.each(['before returning', 'after returning'])(
    'protects the page when the player changes track and the stale read arrives %s',
    (arrival) => {
      const inactive = settled(page('/about', listener), 'inactive')
      const navigation = send(inactive, changed('https://gbfm.co.za/mixes/local-frequencies')).model
      const saved = savePlayerFavorite(navigation, true)
      const other = changeTrack(saved, { ...track, id: 'mix-b', slug: 'other-mix' })
      const returned = arrival === 'after returning' ? changeTrack(other, track) : other
      const loaded = loadMixPage(returned).model

      expect(loaded.publicAction.document?.state).toBe('active')

      expect(loaded.player.favorite).toMatchObject({
        track: { audioId: arrival === 'after returning' ? 'mix-a' : 'mix-b' },
        status: arrival === 'after returning' ? 'active' : 'loading',
      })

      const back = send(loaded, changed('https://gbfm.co.za/about')).model

      const about = send(
        back,
        Message.LoadedPage({
          flags: page('/about', listener),
          key: '/about',
          navigationId: back.navigationId,
        }),
      ).model

      const playingAgain = changeTrack(about, track)

      const settledAgain = favorite(
        playingAgain,
        Player.Favorite.Message.Loaded({
          generation: playingAgain.player.favorite.generation,
          state: 'active',
          principalId: listener.id,
          principalKnown: true,
        }),
      ).model

      const revisit = send(
        settledAgain,
        changed('https://gbfm.co.za/mixes/local-frequencies'),
      ).model

      expect(revisit.publicAction.document?.state).toBe('active')
      expect(loadMixPage(revisit).model.player.favorite.status).toBe('inactive')
    },
  )

  it('keeps an overtaken page save without replacing the favorite of a different playing track', () => {
    const inactive = settled(mixPage('inactive'), 'inactive')
    const other = changeTrack(inactive, { ...track, id: 'mix-b', slug: 'other-mix' })
    const navigation = send(other, changed('https://gbfm.co.za/mixes/local-frequencies')).model

    const pending = send(
      observePage(navigation, false, 17),
      Message.GotPublicActionMessage({ message: PublicActions.Message.Toggle() }),
    ).model

    expect(pending.publicAction.busy).toBe(true)

    const saved = send(
      pending,
      Message.GotPublicActionMessage({
        message: PublicActions.Message.Saved({
          target: { id: 'mix-a', kind: 'audio' },
          active: true,
          principalId: listener.id,
          requestId: pending.publicAction.requestId,
        }),
      }),
    ).model

    const loaded = loadMixPage(saved).model

    expect(loaded.publicAction.document?.state).toBe('active')
    expect(loaded.player.favorite.track?.audioId).toBe('mix-b')
    expect(loaded.player.favorite.status).toBe('loading')
  })

  it('does not apply a save to another audio page in the same account', () => {
    const inactive = settled(page('/about', listener), 'inactive')
    const navigation = send(inactive, changed('https://gbfm.co.za/mixes/other-mix')).model
    const saved = savePlayerFavorite(navigation, true)

    const loaded = send(
      saved,
      Message.LoadedPage({
        flags: page('/mixes/other-mix', listener, {
          target: { id: 'mix-b', kind: 'audio' },
          path: '/mixes/other-mix',
          state: 'inactive',
        }),
        key: '/mixes/other-mix',
        navigationId: navigation.navigationId,
      }),
    ).model

    expect(loaded.publicAction.document?.state).toBe('inactive')
    expect(loaded.player.favorite.status).toBe('active')
  })

  it('adopts a different account without carrying over the previous account save', () => {
    const inactive = settled(page('/about', listener), 'inactive')
    const navigation = send(inactive, changed('https://gbfm.co.za/mixes/local-frequencies')).model
    const saved = savePlayerFavorite(navigation, true)
    const loaded = loadMixPage(saved, mixPage('inactive', { ...listener, id: 'user-2' })).model

    expect(loaded.publicAction.document?.state).toBe('inactive')
    expect(loaded.player.favorite.principalId).toBe('user-2')
    expect(loaded.player.favorite.status).toBe('inactive')
  })

  it('does not treat a failed player save as an acknowledged change', () => {
    const active = settled(page('/about', listener), 'active')
    const navigation = send(active, changed('https://gbfm.co.za/mixes/local-frequencies')).model
    const saving = favorite(navigation, Player.Favorite.Message.Toggled()).model

    expect(saving.player.favorite.status).toBe('active')

    const failed = favorite(
      saving,
      Player.Favorite.Message.SaveFailed({
        generation: saving.player.favorite.generation,
        unauthorized: false,
        principalId: listener.id,
      }),
    ).model

    const loaded = loadMixPage(failed).model

    expect(loaded.publicAction.document?.state).toBe('inactive')
    expect(loaded.player.favorite).toMatchObject({
      status: 'active',
      revision: 17,
      mutationId: 'da5495ab-6f07-4a4f-bb5e-0f9355e71e40',
    })
  })

  it('keeps the last acknowledged change when multiple player saves overtake a page read', () => {
    const inactive = settled(page('/about', listener), 'inactive')
    const navigation = send(inactive, changed('https://gbfm.co.za/mixes/local-frequencies')).model
    const added = savePlayerFavorite(navigation, true)
    const removed = savePlayerFavorite(added, false)
    const loaded = loadMixPage(removed, mixPage('active')).model

    expect(loaded.publicAction.document?.state).toBe('inactive')
    expect(loaded.player.favorite.status).toBe('inactive')
  })
})
