import { Predicate } from 'effect'
import { Command, Update } from 'foldkit'

import type { Services } from './init'
import { Message } from './message'
import type { Model } from './model'
import * as Player from './player'
import * as PublicActions from './public-actions'

type Return = Update.Return<Model, Message, Services>

type Step = (model: Model) => Return

const toPlayer =
  (message: Player.Message): Step =>
  (model) => {
    const child = Player.update(model.player, message)

    return {
      model: child.model === model.player ? model : { ...model, player: child.model },
      commands: Command.mapMessages(child.commands ?? [], (message) =>
        Message.GotPlayerMessage({ message }),
      ),
    }
  }

const adoptInPage =
  (audioId: string, active: boolean, principalId: string, revision: number): Step =>
  (model) => {
    const publicAction: PublicActions.Model = model.publicAction
    const document = publicAction.document

    return !document ||
      publicAction.principalId !== principalId ||
      document.target.kind !== 'audio' ||
      document.target.id !== audioId ||
      (publicAction.busy && publicAction.revision !== null) ||
      publicAction.mutationId !== null ||
      !['active', 'inactive'].includes(document.state)
      ? { model }
      : {
          model: {
            ...model,
            publicAction: {
              ...publicAction,
              revision,
              busy: false,
              requestId: publicAction.requestId + 1,
              document: { ...document, state: active ? 'active' : 'inactive' },
            },
          },
        }
  }

const acceptedPlayerSave = (previous: Model, message: Message, next: Model) =>
  Predicate.isTagged(message, 'GotPlayerMessage') &&
  Predicate.isTagged(message.message, 'GotFavoriteMessage') &&
  Predicate.isTagged(message.message.message, 'Saved') &&
  next.player.favorite !== previous.player.favorite
    ? message.message.message
    : null

const acceptedPageSave = (previous: Model, message: Message, next: Model) =>
  Predicate.isTagged(message, 'GotPublicActionMessage') &&
  Predicate.isTagged(message.message, 'Saved') &&
  message.message.target.kind === 'audio' &&
  next.publicAction !== previous.publicAction
    ? message.message
    : null

const pageFavorite = (model: Model, principalId: string | null) => {
  const document = model.publicAction.document

  return document?.target.kind === 'audio' &&
    principalId !== null &&
    model.publicAction.principalId === principalId &&
    model.publicAction.revision !== null &&
    !model.publicAction.busy &&
    model.publicAction.mutationId === null &&
    document.target.id === model.player.favorite.track?.audioId &&
    (document.state === 'active' || document.state === 'inactive')
    ? {
        audioId: document.target.id,
        active: document.state === 'active',
        revision: model.publicAction.revision,
      }
    : null
}

const playerFavorite = (model: Model) => {
  const { track, status, saving, revision, mutationId } = model.player.favorite

  return track &&
    model.player.favorite.principalId &&
    !saving &&
    revision !== null &&
    mutationId === null &&
    (status === 'active' || status === 'inactive')
    ? {
        audioId: track.audioId,
        active: status === 'active',
        principalId: model.player.favorite.principalId,
        revision,
      }
    : null
}

const invalidatePageAccount: Step = (model) => {
  const publicAction = model.publicAction

  if (!publicAction.document || publicAction.principalId === model.player.favorite.principalId)
    return { model }

  const child = PublicActions.load({
    ...publicAction,
    principalId: model.player.favorite.principalId,
    revision: null,
    mutationId: null,
    requestId: publicAction.requestId + 1,
    busy: false,
    notice: null,
    document: {
      ...publicAction.document,
      state:
        model.player.favorite.principalKnown && model.player.favorite.principalId === null
          ? 'anonymous'
          : 'unavailable',
    },
  })

  return {
    model: { ...model, publicAction: child.model },
    commands: Command.mapMessages(child.commands ?? [], (message) =>
      Message.GotPublicActionMessage({ message }),
    ),
  }
}

const steps = (previous: Model, message: Message, next: Model): ReadonlyArray<Step> => {
  const loadedFlags =
    Predicate.isTagged(message, 'LoadedPage') && message.navigationId === previous.navigationId
      ? message.flags
      : null

  const identityChangedDuringRead =
    previous.player.favorite.principalId !== previous.navigationPrincipalId ||
    previous.player.favorite.principalKnown !== previous.navigationPrincipalKnown

  const acceptsPageIdentity =
    loadedFlags &&
    (loadedFlags.principal !== null || loadedFlags.principalKnown === true) &&
    (!identityChangedDuringRead ||
      (loadedFlags.principal?.id ?? null) === next.player.favorite.principalId)

  const pageConfirmedSignOut =
    Predicate.isTagged(message, 'GotPublicActionMessage') &&
    (Predicate.isTagged(message.message, 'Failed') ||
      Predicate.isTagged(message.message, 'LoadFailed')) &&
    message.message.unauthorized &&
    next.publicAction !== previous.publicAction

  const principalId = pageConfirmedSignOut
    ? null
    : acceptsPageIdentity
      ? (loadedFlags.principal?.id ?? null)
      : next.player.favorite.principalId

  const principalKnown =
    pageConfirmedSignOut || acceptsPageIdentity ? true : next.player.favorite.principalKnown

  const playerSave = acceptedPlayerSave(previous, message, next)
  const pageSave = acceptedPageSave(previous, message, next)
  const pageReplaced = next.publicAction !== previous.publicAction && !pageSave

  const overtakingSave =
    pageReplaced && Predicate.isTagged(message, 'LoadedPage')
      ? next.navigationFavoriteChanges.find(
          (change) =>
            change.principalId === next.publicAction.principalId &&
            change.principalId === principalId &&
            next.publicAction.document?.target.kind === 'audio' &&
            change.audioId === next.publicAction.document.target.id,
        )
      : undefined

  const fresh =
    pageReplaced &&
    Predicate.isTagged(message, 'GotPublicActionMessage') &&
    Predicate.isTagged(message.message, 'Loaded')
      ? pageFavorite(next, principalId)
      : null

  const cached =
    pageReplaced && Predicate.isTagged(message, 'ChangedUrl') ? playerFavorite(next) : null

  return [
    ...(principalId === next.player.favorite.principalId &&
    principalKnown === next.player.favorite.principalKnown
      ? []
      : [toPlayer(Player.Message.PrincipalChanged({ principalId, principalKnown }))]),
    ...(next.publicAction.document && next.publicAction.principalId !== principalId
      ? [invalidatePageAccount]
      : []),
    ...(playerSave
      ? [
          adoptInPage(
            playerSave.audioId,
            playerSave.active,
            playerSave.principalId,
            playerSave.revision,
          ),
        ]
      : []),
    ...(pageSave
      ? [
          toPlayer(
            Player.Message.FavoriteChangedElsewhere({
              audioId: pageSave.target.id,
              active: pageSave.active,
              revision: pageSave.revision,
            }),
          ),
        ]
      : []),
    ...(overtakingSave
      ? [
          adoptInPage(
            overtakingSave.audioId,
            overtakingSave.active,
            overtakingSave.principalId,
            overtakingSave.revision,
          ),
          toPlayer(Player.Message.FavoriteChangedElsewhere(overtakingSave)),
        ]
      : []),
    ...(fresh ? [toPlayer(Player.Message.FavoriteChangedElsewhere(fresh))] : []),
    ...(cached
      ? [adoptInPage(cached.audioId, cached.active, cached.principalId, cached.revision)]
      : []),
  ]
}

/**
 * Keeps the player heart bound to the queued track and signed-in account. When the page favorite
 * control shows the same audio, server-acknowledged saves flow both ways; freshly loaded page data
 * updates the player, while cached page data defers to the player's newer knowledge.
 */
export const syncPlayerFavorite = (previous: Model, message: Message, result: Return): Return => {
  const playerSave = acceptedPlayerSave(previous, message, result.model)
  const pageSave = acceptedPageSave(previous, message, result.model)
  const principalId = playerSave?.principalId ?? pageSave?.principalId

  const change = playerSave
    ? { audioId: playerSave.audioId, active: playerSave.active, revision: playerSave.revision }
    : pageSave
      ? { audioId: pageSave.target.id, active: pageSave.active, revision: pageSave.revision }
      : null

  const model =
    change && principalId
      ? {
          ...result.model,
          navigationFavoriteChanges: [
            ...result.model.navigationFavoriteChanges.filter(
              (saved) => saved.principalId !== principalId || saved.audioId !== change.audioId,
            ),
            { ...change, principalId },
          ],
        }
      : result.model

  const pending = steps(previous, message, model)

  if (pending.length === 0) return { ...result, model }
  const synced = Update.combine(model, pending)

  return {
    model: synced.model,
    commands: [...(result.commands ?? []), ...(synced.commands ?? [])],
  }
}
