import { AudioPageResponse } from '@gbfm/api/audio'
import {
  MembershipMutationResult,
  MembershipRevision,
  MembershipStateResponse,
} from '@gbfm/api/favorites'
import { QueueTrack, type QueueTrackType } from '@gbfm/player'
import { Effect, Match, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { iconPaths, lucide } from '../view/icons'

const Track = Schema.Struct({
  audioId: Schema.String,
  type: QueueTrack.fields.type,
  slug: Schema.String,
})

type Track = typeof Track.Type

export const Status = Schema.Literals([
  'idle',
  'loading',
  'anonymous',
  'active',
  'inactive',
  'unavailable',
])

export const Model = Schema.Struct({
  track: Schema.NullOr(Track),
  principalId: Schema.NullOr(Schema.String),
  principalKnown: Schema.Boolean,
  generation: Schema.Number,
  status: Status,
  saving: Schema.Boolean,
  notice: Schema.NullOr(Schema.String),
  noticeId: Schema.Number,
  revision: Schema.NullOr(MembershipRevision),
  mutationId: Schema.NullOr(Schema.String),
})

export type Model = typeof Model.Type

export const initialModel: Model = {
  track: null,
  principalId: null,
  principalKnown: false,
  generation: 0,
  status: 'idle',
  saving: false,
  notice: null,
  noticeId: 0,
  revision: null,
  mutationId: null,
}

const LoadedState = Schema.Literals(['anonymous', 'active', 'inactive', 'unavailable'])

export const Message = defineMessageUnion({
  Loaded: {
    generation: Schema.Number,
    state: LoadedState,
    principalId: Schema.NullOr(Schema.String),
    principalKnown: Schema.Boolean,
    revision: Schema.NullOr(MembershipRevision),
  },
  Toggled: {},
  Retried: {},
  Saved: {
    generation: Schema.Number,
    audioId: Schema.String,
    active: Schema.Boolean,
    principalId: Schema.String,
    revision: MembershipRevision,
  },
  SaveFailed: {
    generation: Schema.Number,
    unauthorized: Schema.Boolean,
    principalId: Schema.String,
    conflicted: Schema.Boolean,
    mutationId: Schema.String,
  },
  NoticeDismissed: { generation: Schema.Number, noticeId: Schema.Number },
})

export type Message = typeof Message.Type

const DismissNotice = Command.define('PlayerFavorite.DismissNotice', {
  args: { generation: Schema.Number, noticeId: Schema.Number },
  messages: [Message.NoticeDismissed],
  execute: ({ generation, noticeId }) =>
    Effect.sleep('4 seconds').pipe(Effect.as(Message.NoticeDismissed({ generation, noticeId }))),
})

const notify = (model: Model, notice: string): Update.Return<Model, Message> => {
  const noticeId = model.noticeId + 1

  return {
    model: { ...model, notice, noticeId },
    commands: [DismissNotice({ generation: model.generation, noticeId })],
  }
}

const Load = Command.define('PlayerFavorite.Load', {
  args: { generation: Schema.Number, track: Track },
  messages: [Message.Loaded],
  execute: ({ generation, track }) =>
    Effect.tryPromise(async (signal) => {
      const response = await fetch(
        `/api/content/audio/${track.type}/${encodeURIComponent(track.slug)}/page`,
        { credentials: 'same-origin', signal },
      )

      if (!response.ok) throw new Error('Favorite status unavailable')

      return response.json()
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(AudioPageResponse)),
      Effect.flatMap((page) =>
        Effect.gen(function* () {
          const ready = AudioPageResponse.guards.Ready(page) && page.audio.id === track.audioId

          if (ready && page.principal && ['active', 'inactive'].includes(page.favorite)) {
            const response = yield* Effect.tryPromise((signal) =>
              fetch(`/api/favorites/audio/${encodeURIComponent(track.audioId)}/state`, {
                credentials: 'same-origin',
                cache: 'no-store',
                signal,
              }),
            )

            if (!response.ok)
              return Message.Loaded({
                generation,
                state: response.status === 401 ? 'anonymous' : 'unavailable',
                principalId: page.principal.id,
                principalKnown: true,
                revision: null,
              })
            const body = yield* Effect.tryPromise(() => response.json())
            const state = yield* Schema.decodeUnknownEffect(MembershipStateResponse)(body)

            return Message.Loaded({
              generation,
              state: state.favorited ? 'active' : 'inactive',
              principalId: page.principal.id,
              principalKnown: true,
              revision: state.revision,
            })
          }

          return Message.Loaded({
            generation,
            principalId: page.principal?.id ?? null,
            principalKnown: true,
            revision: null,
            state:
              AudioPageResponse.guards.Ready(page) && page.audio.id === track.audioId
                ? page.favorite
                : 'unavailable',
          })
        }),
      ),
      Effect.orElseSucceed(() =>
        Message.Loaded({
          generation,
          state: 'unavailable',
          principalId: null,
          principalKnown: false,
          revision: null,
        }),
      ),
    ),
})

const Save = Command.define('PlayerFavorite.Save', {
  args: {
    generation: Schema.Number,
    audioId: Schema.String,
    active: Schema.Boolean,
    principalId: Schema.String,
    expectedRevision: MembershipRevision,
    mutationId: Schema.NullOr(Schema.String),
  },
  messages: [Message.Saved, Message.SaveFailed],
  execute: ({ generation, audioId, active, principalId, expectedRevision, mutationId }) =>
    Effect.gen(function* () {
      const id = mutationId ?? (yield* Effect.sync(() => crypto.randomUUID()))

      const fail = (unauthorized = false, conflicted = false) =>
        Message.SaveFailed({ generation, unauthorized, conflicted, mutationId: id, principalId })

      return yield* Effect.gen(function* () {
        const mutation = { requestId: id, expectedRevision }

        const response = yield* Effect.tryPromise((signal) =>
          fetch(active ? '/api/favorites' : `/api/favorites/${encodeURIComponent(audioId)}`, {
            method: active ? 'POST' : 'DELETE',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(active ? { ...mutation, audioId } : mutation),
            signal,
          }),
        )

        if (!response.ok)
          return fail(response.status === 401, response.status === 409 || response.status === 410)
        const body = yield* Effect.tryPromise(() => response.json())
        const result = yield* Schema.decodeUnknownEffect(MembershipMutationResult)(body)

        if (
          result.requestId !== id ||
          result.targetKind !== 'audio' ||
          result.targetId !== audioId ||
          result.desiredState !== active ||
          result.revision !== expectedRevision + 1
        )
          return fail()

        return Message.Saved({
          generation,
          audioId,
          active,
          principalId,
          revision: result.revision,
        })
      }).pipe(Effect.orElseSucceed(() => fail()))
    }),
})

const sameTrack = (left: Track | null, right: Track | null) =>
  left?.audioId === right?.audioId && left?.type === right?.type && left?.slug === right?.slug

const trackOf = (current: QueueTrackType | null): Track | null =>
  current?.slug ? { audioId: current.id, type: current.type, slug: current.slug } : null

const load = (model: Model): Update.Return<Model, Message> => {
  const generation = model.generation + 1

  const reset = {
    ...model,
    generation,
    saving: false,
    notice: null,
    revision: null,
    mutationId: null,
  }

  if (!model.track) return { model: { ...reset, status: 'idle' } }

  return {
    model: { ...reset, status: 'loading' },
    commands: [Load({ generation, track: model.track })],
  }
}

/** Resets favorite state whenever the playing track or signed-in account changes. */
export const sync = (
  model: Model,
  current: QueueTrackType | null,
  principalId: string | null,
  principalKnown = principalId !== null || model.principalKnown,
): Update.Return<Model, Message> => {
  const track = trackOf(current)

  return sameTrack(model.track, track) &&
    model.principalId === principalId &&
    model.principalKnown === principalKnown
    ? { model }
    : load({ ...model, track, principalId, principalKnown })
}

/** Adopts a server-acknowledged favorite change made by another control for the same audio. */
export const reconcile = (
  model: Model,
  audioId: string,
  active: boolean,
  revision: number,
): Model =>
  model.track?.audioId !== audioId ||
  model.saving ||
  !['loading', 'active', 'inactive'].includes(model.status)
    ? model
    : {
        ...model,
        generation: model.generation + 1,
        status: active ? 'active' : 'inactive',
        revision,
        mutationId: null,
        notice: null,
      }

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    Loaded: ({ generation, state, principalId, principalKnown, revision }) => {
      if (generation !== model.generation || model.status !== 'loading') return { model }

      const identified = {
        ...model,
        principalId: principalKnown ? principalId : model.principalId,
        principalKnown: principalKnown || model.principalKnown,
        revision,
      }

      return state === 'unavailable'
        ? notify({ ...identified, status: state }, 'Favorite status could not be loaded.')
        : { model: { ...identified, status: state, notice: null } }
    },
    NoticeDismissed: ({ generation, noticeId }) =>
      generation === model.generation && noticeId === model.noticeId && model.notice !== null
        ? { model: { ...model, notice: null } }
        : { model },
    Retried: () => (model.status === 'unavailable' ? load(model) : { model }),
    Toggled: () => {
      if (
        !model.track ||
        !model.principalId ||
        model.saving ||
        model.revision === null ||
        !['active', 'inactive'].includes(model.status)
      )
        return { model }

      return {
        model: { ...model, saving: true, notice: null },
        commands: [
          Save({
            generation: model.generation,
            audioId: model.track.audioId,
            active: model.status !== 'active',
            principalId: model.principalId,
            expectedRevision: model.revision,
            mutationId: model.mutationId,
          }),
        ],
      }
    },
    Saved: ({ generation, active, principalId, audioId, revision }) =>
      generation !== model.generation ||
      principalId !== model.principalId ||
      audioId !== model.track?.audioId ||
      !model.saving
        ? { model }
        : {
            model: {
              ...model,
              saving: false,
              revision,
              mutationId: null,
              status: active ? 'active' : 'inactive',
            },
          },
    SaveFailed: ({ generation, unauthorized, principalId, conflicted, mutationId }) =>
      generation !== model.generation || principalId !== model.principalId || !model.saving
        ? { model }
        : conflicted
          ? load({ ...model, saving: false })
          : notify(
              {
                ...model,
                saving: false,
                status: unauthorized ? 'anonymous' : model.status,
                principalId: unauthorized ? null : model.principalId,
                principalKnown: unauthorized || model.principalKnown,
                mutationId: unauthorized ? null : mutationId,
              },
              unauthorized
                ? 'Your session has ended. Sign in to favorite.'
                : 'Favorite could not be saved. Try again.',
            ),
  })

const heartButton =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-[0.75rem] border-0 bg-transparent p-0 text-muted-foreground no-underline transition-[transform,background-color,color] hover:bg-foreground/10 hover:text-foreground active:scale-90 aria-pressed:text-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

export const button = <M>(
  model: Model,
  h: HtmlBuilder<M>,
  toMessage: (message: Message) => M,
  returnTo: string,
) => {
  const heart = (filled: boolean) =>
    lucide(
      iconPaths.heart,
      `size-6 [stroke-linecap:square] [stroke-linejoin:miter] ${filled ? 'fill-current' : ''}`,
    )

  return Match.value(model.status).pipe(
    Match.when('idle', () => h.empty),
    Match.when('anonymous', () =>
      h.a(
        [
          h.Href(`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`),
          h.AriaLabel('Sign in to favorite'),
          h.Title('Sign in to favorite'),
          h.Class(heartButton),
        ],
        [heart(false)],
      ),
    ),
    Match.when('loading', () =>
      h.button(
        [
          h.Type('button'),
          h.Disabled(true),
          h.AriaBusy(true),
          h.AriaLabel('Checking favorite'),
          h.Class(heartButton),
        ],
        [heart(false)],
      ),
    ),
    Match.when('unavailable', () =>
      h.button(
        [
          h.Type('button'),
          h.OnClick(toMessage(Message.Retried())),
          h.AriaLabel('Retry loading favorite'),
          h.Title('Retry loading favorite'),
          h.Class(heartButton),
        ],
        [heart(false)],
      ),
    ),
    Match.whenOr('active', 'inactive', (status) => {
      const active = status === 'active'
      const label = active ? 'Remove from favorites' : 'Add to favorites'

      return h.button(
        [
          h.Type('button'),
          h.Disabled(model.saving || model.revision === null),
          h.AriaBusy(model.saving),
          h.AriaPressed(String(active)),
          h.OnClick(toMessage(Message.Toggled())),
          h.AriaLabel(label),
          h.Title(label),
          h.Class(heartButton),
        ],
        [heart(active)],
      )
    }),
    Match.exhaustive,
  )
}

export const notice = <M>(model: Model, h: HtmlBuilder<M>, toMessage: (message: Message) => M) =>
  model.notice
    ? h.div(
        [
          h.Key(`favorite-notice-${model.generation}-${model.noticeId}`),
          h.Role('status'),
          h.AriaLive('polite'),
          h.AriaAtomic(true),
          h.Class(
            'absolute inset-x-0 bottom-full z-10 mb-3 flex items-center gap-2 rounded border border-highlight/40 border-l-2 bg-background pl-4 text-sm text-foreground shadow-lg',
          ),
        ],
        [
          h.span([h.Class('min-w-0 flex-1 py-3')], [model.notice]),
          h.button(
            [
              h.Type('button'),
              h.AriaLabel('Dismiss favorite notice'),
              h.OnClick(
                toMessage(
                  Message.NoticeDismissed({
                    generation: model.generation,
                    noticeId: model.noticeId,
                  }),
                ),
              ),
              h.Class(
                'inline-flex size-11 shrink-0 items-center justify-center text-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              ),
            ],
            [lucide(iconPaths.close, 'size-4')],
          ),
        ],
      )
    : h.empty
