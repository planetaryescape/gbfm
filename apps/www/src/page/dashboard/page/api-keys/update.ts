import { KeyId } from '@gbfm/core/personal-access-keys'
import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'

import { Message, type Model } from './model'
import { KeyService } from './service'

export const Load = Command.define('PersonalAccessKeys.Load', {
  args: { offset: Schema.Number },
  messages: [Message.Loaded, Message.Failed],
  execute: ({ offset }) =>
    KeyService.pipe(
      Effect.flatMap((service) => service.list(offset)),
      Effect.map((page) => Message.Loaded({ page })),
      Effect.catch((error) => Effect.succeed(Message.Failed({ message: error.message }))),
    ),
})

const Revoke = Command.define('PersonalAccessKeys.Revoke', {
  args: { id: KeyId },
  messages: [Message.Revoked, Message.Failed],
  execute: ({ id }) =>
    KeyService.pipe(
      Effect.flatMap((service) => service.revoke(id)),
      Effect.as(Message.Revoked()),
      Effect.catch((error) => Effect.succeed(Message.Failed({ message: error.message }))),
    ),
})

export const update = (model: Model, message: Message): Update.Return<Model, Message, KeyService> =>
  Message.match<Update.Return<Model, Message, KeyService>>(message, {
    Refresh: ({ offset }) =>
      model.phase === 'revoking'
        ? { model }
        : {
            model: { ...model, phase: 'loading', error: null, confirming: null },
            commands: [Load({ offset })],
          },
    Loaded: ({ page }) => ({ model: { ...model, page, phase: 'ready', error: null } }),
    Failed: ({ message }) => ({ model: { ...model, phase: 'ready', error: message } }),
    Issued: () => ({
      model: {
        ...model,
        phase: 'loading',
        notice: 'Key created. Save the secret below before leaving this page.',
      },
      commands: [Load({ offset: 0 })],
    }),
    ConfirmRevoke: ({ id }) =>
      model.phase === 'ready' && model.page?.data.some((key) => key.id === id && !key.revokedAt)
        ? { model: { ...model, confirming: id, notice: null } }
        : { model },
    CancelRevoke: () => ({ model: { ...model, confirming: null } }),
    Revoke: () =>
      model.confirming && model.phase === 'ready'
        ? {
            model: { ...model, phase: 'revoking', error: null },
            commands: [Revoke({ id: model.confirming })],
          }
        : { model },
    Revoked: () => ({
      model: { ...model, phase: 'loading', confirming: null, notice: 'API key revoked.' },
      commands: [Load({ offset: model.page?.pagination.offset ?? 0 })],
    }),
  })
