import { Command } from '@effect/ui'
import {
  MembershipMutationResult,
  MembershipRevision,
  MembershipStateResponse,
} from '@gbfm/api/favorites'
import { Context, Effect, Layer, Schema } from 'effect'

import { MembershipMessage, MembershipTarget } from './domain'

export class MembershipRequestError extends Schema.TaggedError<MembershipRequestError>()(
  'MembershipRequestError',
  {},
) {}

export class MembershipHttp extends Context.Service<
  MembershipHttp,
  {
    readonly request: (
      url: string,
      init?: RequestInit,
    ) => Effect.Effect<Response, MembershipRequestError>
    readonly requestId: Effect.Effect<string>
  }
>()('membership/Http') {}

export const membershipHttpLayer = Layer.succeed(MembershipHttp, {
  request: (url, init) =>
    Effect.tryPromise({
      try: (signal) => fetch(url, { ...init, credentials: 'same-origin', signal }),
      catch: () => new MembershipRequestError(),
    }),
  requestId: Effect.sync(() => crypto.randomUUID()),
})

const correlation = {
  target: MembershipTarget,
  principalId: Schema.String,
  generation: Schema.Number,
  request: Schema.Number,
}

export class LoadMembership extends Command.Service<LoadMembership>()('membership/LoadMembership', {
  args: correlation,
  success: Schema.Union([
    MembershipMessage.cases.SucceededLoadMembership,
    MembershipMessage.cases.FailedLoadMembership,
  ]),
}) {
  static readonly layer = this.toLayer(
    Effect.map(
      MembershipHttp,
      (http) => (args) =>
        Effect.gen(function* () {
          const response = yield* http.request(
            `/api/favorites/${args.target.kind}/${encodeURIComponent(args.target.id)}/state`,
            { cache: 'no-store' },
          )

          if (!response.ok)
            return MembershipMessage.FailedLoadMembership({
              ...args,
              unauthorized: response.status === 401,
            })
          const body = yield* Effect.tryPromise(() => response.json())
          const state = yield* Schema.decodeUnknownEffect(MembershipStateResponse)(body)
          const active = args.target.kind === 'audio' ? state.favorited : state.subscribed

          if (active === null)
            return MembershipMessage.FailedLoadMembership({ ...args, unauthorized: false })

          return MembershipMessage.SucceededLoadMembership({
            ...args,
            active,
            revision: state.revision,
          })
        }).pipe(
          Effect.orElseSucceed(() =>
            MembershipMessage.FailedLoadMembership({ ...args, unauthorized: false }),
          ),
        ),
    ),
  )
}

const SaveMembershipArguments = {
  ...correlation,
  active: Schema.Boolean,
  expectedRevision: MembershipRevision,
  mutationId: Schema.NullOr(Schema.String),
}

const SaveMembershipArgs = Schema.Struct(SaveMembershipArguments)

export class SaveMembership extends Command.Service<SaveMembership>()('membership/SaveMembership', {
  args: SaveMembershipArguments,
  success: Schema.Union([
    MembershipMessage.cases.SucceededSaveMembership,
    MembershipMessage.cases.FailedSaveMembership,
  ]),
}) {
  static readonly implementation = Effect.map(
    MembershipHttp,
    (http) => (args: typeof SaveMembershipArgs.Type) =>
      Effect.gen(function* () {
        const id = args.mutationId ?? (yield* http.requestId)

        const failed = (unauthorized = false, conflicted = false) =>
          MembershipMessage.FailedSaveMembership({
            ...args,
            mutationId: id,
            unauthorized,
            conflicted,
          })

        return yield* Effect.gen(function* () {
          let path = `/api/favorites/${encodeURIComponent(args.target.id)}`

          if (args.target.kind === 'show')
            path = `/api/shows/${encodeURIComponent(args.target.id)}/${args.active ? 'subscribe' : 'unsubscribe'}`
          else if (args.active) path = '/api/favorites'
          const mutation = { requestId: id, expectedRevision: args.expectedRevision }

          const body =
            args.target.kind === 'audio' && args.active
              ? { ...mutation, audioId: args.target.id }
              : mutation

          const response = yield* http.request(path, {
            method: args.active ? 'POST' : 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })

          if (!response.ok)
            return failed(
              response.status === 401,
              response.status === 409 || response.status === 410,
            )
          const bodyResult = yield* Effect.tryPromise(() => response.json())
          const result = yield* Schema.decodeUnknownEffect(MembershipMutationResult)(bodyResult)

          if (
            result.requestId !== id ||
            result.targetKind !== args.target.kind ||
            result.targetId !== args.target.id ||
            result.desiredState !== args.active ||
            result.revision !== args.expectedRevision + 1
          )
            return failed()

          return MembershipMessage.SucceededSaveMembership({ ...args, revision: result.revision })
        }).pipe(Effect.orElseSucceed(() => failed()))
      }),
  )
  static readonly layer = this.toLayer(this.implementation)
}

export const membershipCommandsLayer = Layer.mergeAll(
  LoadMembership.layer,
  SaveMembership.layer,
).pipe(Layer.provide(membershipHttpLayer))
