import { spotifyEntityFromUrl } from '@gbfm/spotify/entity'
import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { disconnected, SpotifyConnection, SpotifyStatus } from './connection'

const Action = Schema.Literals(['connect', 'play', 'queue'])

const Operation = Schema.TaggedUnion({
  Idle: { target: Schema.NullOr(Schema.String), notice: Schema.String },
  Running: { action: Action, url: Schema.String },
})

export const Model = Schema.Struct({
  status: Schema.NullOr(SpotifyStatus),
  statusRequestId: Schema.Number,
  operation: Operation,
})

export type Model = typeof Model.Type

export const initialModel: Model = {
  status: null,
  statusRequestId: 0,
  operation: Operation.cases.Idle.make({ target: null, notice: '' }),
}

export const Message = defineMessageUnion({
  Requested: { action: Action, url: Schema.String },
  Loaded: { requestId: Schema.Number, status: SpotifyStatus },
  ConnectionChanged: { status: SpotifyStatus },
  Completed: { notice: Schema.String },
})

export type Message = typeof Message.Type

export const Load = Command.define('Spotify.PlaybackStatus', {
  args: { requestId: Schema.Number },
  messages: [Message.Loaded],
  execute: ({ requestId }) =>
    SpotifyConnection.pipe(
      Effect.flatMap((service) => service.status),
      Effect.orElseSucceed(() => disconnected),
      Effect.map((status) => Message.Loaded({ requestId, status })),
    ),
})

const Request = Command.define('Spotify.Playback', {
  args: { action: Action, url: Schema.String },
  messages: [Message.Completed],
  execute: ({ action, url }) =>
    SpotifyConnection.pipe(
      Effect.flatMap((service) =>
        action === 'connect'
          ? service.connect.pipe(Effect.as(''))
          : service.playback({ action, url }),
      ),
      Effect.catch((error) => Effect.succeed(error.message)),
      Effect.map((notice) => Message.Completed({ notice })),
    ),
})

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, SpotifyConnection> =>
  Message.match<Update.Return<Model, Message, SpotifyConnection>>(message, {
    Requested: ({ action, url }) =>
      Operation.guards.Running(model.operation)
        ? { model }
        : {
            model: { ...model, operation: Operation.cases.Running.make({ action, url }) },
            commands: [Request({ action, url })],
          },
    Loaded: ({ requestId, status }) => ({
      model: requestId === model.statusRequestId ? { ...model, status } : model,
    }),
    ConnectionChanged: ({ status }) => ({
      model: { ...model, status, statusRequestId: model.statusRequestId + 1 },
    }),
    Completed: ({ notice }) => ({
      model: {
        ...model,
        operation: Operation.cases.Idle.make({
          target: Operation.match(model.operation, {
            Idle: ({ target }) => target,
            Running: ({ url }) => url,
          }),
          notice,
        }),
      },
    }),
  })

export const view = <M>(
  model: Model,
  h: HtmlBuilder<M>,
  toMessage: (message: Message) => M,
  url: string,
  interactive: boolean,
) => {
  if (!spotifyEntityFromUrl(url)) return h.empty
  const connected = model.status?.connected
  const busy = Operation.guards.Running(model.operation)

  const target = Operation.match(model.operation, {
    Idle: ({ target }) => target,
    Running: ({ url }) => url,
  })

  const notice = Operation.match(model.operation, {
    Idle: ({ notice }) => notice,
    Running: () => 'Working…',
  })

  const button = (action: 'connect' | 'play' | 'queue', label: string) =>
    h.button(
      [
        h.Type('button'),
        h.Disabled(!interactive || model.status === null || busy),
        h.OnClick(toMessage(Message.Requested({ action, url }))),
        h.AriaBusy(busy && target === url),
        h.Class(action === 'play' ? 'btn btn-primary' : 'btn'),
      ],
      [label],
    )

  return h.div(
    [h.Class('relative z-10 space-y-2 border-t border-border/40 px-4 py-3')],
    [
      h.div(
        [h.Class('flex flex-wrap gap-2')],
        connected
          ? [button('play', 'Play on Spotify'), button('queue', 'Queue on Spotify')]
          : [button('connect', 'Connect Spotify')],
      ),
      h.p(
        [h.Class('text-xs text-muted-foreground')],
        [
          'Spotify Premium and an active Spotify device required. Audio plays in Spotify, not the mix player.',
        ],
      ),
      h.p(
        [h.Role('status'), h.Class('text-xs text-muted-foreground')],
        [target === url ? notice : ''],
      ),
    ],
  )
}
