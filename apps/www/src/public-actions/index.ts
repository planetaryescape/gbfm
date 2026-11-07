import {
  MembershipMutationResult,
  MembershipRevision,
  MembershipStateResponse,
} from '@gbfm/api/favorites'
import { Effect, Match, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { iconPaths, lucide } from '../view/icons'

export const Target = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['audio', 'show']),
})

export const Document = Schema.Struct({
  target: Target,
  path: Schema.String,
  state: Schema.Literals(['anonymous', 'active', 'inactive', 'unavailable']),
})

export type Document = typeof Document.Type

export const Model = Schema.Struct({
  document: Schema.NullOr(Document),
  busy: Schema.Boolean,
  notice: Schema.NullOr(Schema.String),
  principalId: Schema.NullOr(Schema.String),
  requestId: Schema.Number,
  revision: Schema.NullOr(MembershipRevision),
  mutationId: Schema.NullOr(Schema.String),
})

export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  Toggle: {},
  Loaded: {
    target: Target,
    active: Schema.Boolean,
    revision: MembershipRevision,
    principalId: Schema.String,
    requestId: Schema.Number,
  },
  LoadFailed: {
    target: Target,
    unauthorized: Schema.Boolean,
    principalId: Schema.String,
    requestId: Schema.Number,
  },
  Saved: {
    target: Target,
    active: Schema.Boolean,
    revision: MembershipRevision,
    principalId: Schema.String,
    requestId: Schema.Number,
  },
  Failed: {
    target: Target,
    unauthorized: Schema.Boolean,
    conflicted: Schema.Boolean,
    mutationId: Schema.String,
    principalId: Schema.String,
    requestId: Schema.Number,
  },
})

export type Message = typeof Message.Type

const Load = Command.define('PublicActions.Load', {
  args: { target: Target, principalId: Schema.String, requestId: Schema.Number },
  messages: [Message.Loaded, Message.LoadFailed],
  execute: ({ target, principalId, requestId }) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise((signal) =>
        fetch(`/api/favorites/${target.kind}/${encodeURIComponent(target.id)}/state`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        }),
      )

      if (!response.ok)
        return Message.LoadFailed({
          target,
          principalId,
          requestId,
          unauthorized: response.status === 401,
        })

      const body = yield* Effect.tryPromise(() => response.json())
      const state = yield* Schema.decodeUnknownEffect(MembershipStateResponse)(body)
      const active = target.kind === 'audio' ? state.favorited : state.subscribed

      if (active === null)
        return Message.LoadFailed({ target, principalId, requestId, unauthorized: false })

      return Message.Loaded({ target, principalId, requestId, active, revision: state.revision })
    }).pipe(
      Effect.orElseSucceed(() =>
        Message.LoadFailed({ target, principalId, requestId, unauthorized: false }),
      ),
    ),
})

const Save = Command.define('PublicActions.Save', {
  args: {
    target: Target,
    active: Schema.Boolean,
    principalId: Schema.String,
    requestId: Schema.Number,
    expectedRevision: MembershipRevision,
    mutationId: Schema.NullOr(Schema.String),
  },
  messages: [Message.Saved, Message.Failed],
  execute: ({ target, active, principalId, requestId, expectedRevision, mutationId }) =>
    Effect.gen(function* () {
      const id = mutationId ?? (yield* Effect.sync(() => crypto.randomUUID()))

      const failed = (unauthorized = false, conflicted = false) =>
        Message.Failed({ target, principalId, requestId, mutationId: id, unauthorized, conflicted })

      return yield* Effect.gen(function* () {
        const path =
          target.kind === 'show'
            ? `/api/shows/${encodeURIComponent(target.id)}/${active ? 'subscribe' : 'unsubscribe'}`
            : active
              ? '/api/favorites'
              : `/api/favorites/${encodeURIComponent(target.id)}`

        const mutation = { requestId: id, expectedRevision }

        const body =
          target.kind === 'audio' && active ? { ...mutation, audioId: target.id } : mutation

        const response = yield* Effect.tryPromise((signal) =>
          fetch(path, {
            method: active ? 'POST' : 'DELETE',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          }),
        )

        if (!response.ok)
          return failed(
            response.status === 401 || response.status === 403,
            response.status === 409 || response.status === 410,
          )
        const responseBody = yield* Effect.tryPromise(() => response.json())
        const result = yield* Schema.decodeUnknownEffect(MembershipMutationResult)(responseBody)

        if (
          result.requestId !== id ||
          result.targetKind !== target.kind ||
          result.targetId !== target.id ||
          result.desiredState !== active ||
          result.revision !== expectedRevision + 1
        )
          return failed()

        return Message.Saved({ target, active, principalId, requestId, revision: result.revision })
      }).pipe(Effect.orElseSucceed(() => failed()))
    }),
})

export const init = (document: Document | null, principalId: string | null = null): Model => ({
  document,
  principalId,
  requestId: 0,
  revision: null,
  mutationId: null,
  busy: false,
  notice: null,
})

export const load = (model: Model): Update.Return<Model, Message> => {
  if (!model.document || !model.principalId || model.document.state === 'anonymous')
    return { model }
  const requestId = model.requestId + 1

  return {
    model: { ...model, requestId, revision: null, mutationId: null, busy: true },
    commands: [Load({ target: model.document.target, principalId: model.principalId, requestId })],
  }
}

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    Loaded: ({ target, active, revision, principalId, requestId }) =>
      !model.busy ||
      model.revision !== null ||
      principalId !== model.principalId ||
      requestId !== model.requestId ||
      model.document?.target.id !== target.id ||
      model.document.target.kind !== target.kind
        ? { model }
        : {
            model: {
              ...model,
              busy: false,
              revision,
              document: { ...model.document, state: active ? 'active' : 'inactive' },
            },
          },
    LoadFailed: ({ target, unauthorized, principalId, requestId }) =>
      !model.busy ||
      model.revision !== null ||
      principalId !== model.principalId ||
      requestId !== model.requestId ||
      model.document?.target.id !== target.id ||
      model.document.target.kind !== target.kind
        ? { model }
        : {
            model: {
              ...model,
              busy: false,
              principalId: unauthorized ? null : model.principalId,
              document: { ...model.document, state: unauthorized ? 'anonymous' : 'unavailable' },
            },
          },
    Toggle: () =>
      !model.document ||
      !model.principalId ||
      model.busy ||
      model.revision === null ||
      !['active', 'inactive'].includes(model.document.state)
        ? { model }
        : {
            model: { ...model, requestId: model.requestId + 1, busy: true, notice: null },
            commands: [
              Save({
                target: model.document.target,
                active: model.document.state !== 'active',
                principalId: model.principalId,
                requestId: model.requestId + 1,
                expectedRevision: model.revision,
                mutationId: model.mutationId,
              }),
            ],
          },
    Saved: ({ target, active, revision, principalId, requestId }) =>
      !model.busy ||
      model.revision === null ||
      principalId !== model.principalId ||
      requestId !== model.requestId ||
      model.document?.target.id !== target.id ||
      model.document.target.kind !== target.kind
        ? { model }
        : {
            model: {
              ...model,
              busy: false,
              revision,
              mutationId: null,
              document: { ...model.document, state: active ? 'active' : 'inactive' },
              notice: 'Saved',
            },
          },
    Failed: ({ target, unauthorized, conflicted, mutationId, principalId, requestId }) =>
      !model.busy ||
      model.revision === null ||
      principalId !== model.principalId ||
      requestId !== model.requestId ||
      model.document?.target.id !== target.id ||
      model.document.target.kind !== target.kind
        ? { model }
        : conflicted
          ? load({ ...model, busy: false, notice: 'Saved state changed. Review it and try again.' })
          : {
              model: {
                ...model,
                busy: false,
                mutationId: unauthorized ? null : mutationId,
                principalId: unauthorized ? null : model.principalId,
                document: {
                  ...model.document,
                  state: unauthorized ? 'anonymous' : model.document.state,
                },
                notice: unauthorized ? 'Sign in to continue.' : 'Action failed. Please try again.',
              },
            },
  })

export const view = <M>(
  model: Model,
  h: HtmlBuilder<M>,
  message: (message: Message) => M,
  interactive: boolean,
  iconOnly = false,
) => {
  const document = model.document

  if (!document) return h.empty
  const active = document.state === 'active'

  const label = Match.value(document.target.kind).pipe(
    Match.when('show', () => (active ? 'Unsubscribe' : 'Subscribe')),
    Match.orElse(() => (active ? 'Remove from favorites' : 'Add to favorites')),
  )

  const signInLabel = `Sign in to ${document.target.kind === 'show' ? 'subscribe' : 'favorite'}`

  const iconPath = document.target.kind === 'show' ? iconPaths.rss : iconPaths.heart

  const icon = lucide(iconPath, `h-5 w-5 ${active ? 'fill-current' : ''}`)

  const iconButton =
    'inline-flex h-11 w-11 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground no-underline transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 aria-pressed:text-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  const outlineButton =
    'inline-flex h-10 items-center gap-2 rounded-sm border border-border bg-transparent px-4 text-sm font-semibold text-foreground no-underline transition-colors hover:border-foreground hover:bg-muted disabled:opacity-50 aria-pressed:[&_svg]:text-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return h.div(
    [h.Class('flex flex-wrap items-center gap-3')],
    [
      Match.value(document.state).pipe(
        Match.when('anonymous', () =>
          h.a(
            [
              h.Href(`/auth/sign-in?returnTo=${encodeURIComponent(document.path)}`),
              ...(iconOnly ? [h.AriaLabel(signInLabel), h.Title(signInLabel)] : []),
              h.Class(iconOnly ? iconButton : outlineButton),
            ],
            [iconOnly ? icon : signInLabel],
          ),
        ),
        Match.when('unavailable', () =>
          h.p(
            [h.Role('status'), h.Class('text-sm text-muted-foreground')],
            ['Your saved state is unavailable. Reload to try again.'],
          ),
        ),
        Match.orElse(() =>
          h.button(
            [
              h.Type('button'),
              h.Disabled(model.busy || model.revision === null || !interactive),
              h.AriaPressed(String(active)),
              h.OnClick(message(Message.Toggle())),
              ...(iconOnly ? [h.AriaLabel(label), h.Title(label)] : []),
              h.Class(iconOnly ? iconButton : outlineButton),
            ],
            iconOnly
              ? [icon]
              : [
                  lucide(iconPath, 'h-4 w-4'),
                  model.busy ? (model.revision === null ? 'Checking…' : 'Saving…') : label,
                ],
          ),
        ),
      ),
      model.notice
        ? h.p([h.Role('status'), h.Class('text-sm text-muted-foreground')], [model.notice])
        : h.empty,
    ],
  )
}
