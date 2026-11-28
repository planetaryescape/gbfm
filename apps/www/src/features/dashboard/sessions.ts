import { Command, Component, Query, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Context, Effect, Layer, Predicate, Schema } from 'effect'

import { DataTable, Field, Notice } from './presentation'
import { Timestamp } from './timestamp'

const SessionUser = Schema.Struct({ id: Schema.String, name: Schema.String, email: Schema.String })

const SessionMetadata = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  userAgent: Schema.NullOr(Schema.String),
  ipAddress: Schema.NullOr(Schema.String),
})

class SessionRequestError extends Schema.TaggedError<SessionRequestError>()('SessionRequestError', {
  message: Schema.String,
}) {}

export class SessionService extends Context.Service<
  SessionService,
  {
    readonly search: (
      query: string,
    ) => Effect.Effect<ReadonlyArray<typeof SessionUser.Type>, SessionRequestError>
    readonly list: (
      userId: string,
    ) => Effect.Effect<ReadonlyArray<typeof SessionMetadata.Type>, SessionRequestError>
    readonly revoke: (
      userId: string,
      sessionId: string | null,
    ) => Effect.Effect<void, SessionRequestError>
  }
>()('@gbfm/www/native/AdminSessions') {}

export const makeSessionServiceLayer = (fetchImplementation: typeof fetch = globalThis.fetch) =>
  Layer.sync(SessionService, () => {
    const tokens = new Map<string, { readonly userId: string; readonly token: string }>()

    const request = <A>(
      schema: Schema.Codec<A, unknown, never, unknown>,
      path: string,
      body?: Schema.Json,
    ) =>
      Effect.tryPromise({
        try: async (signal) => {
          const response = await fetchImplementation(`/auth/admin/${path}`, {
            credentials: 'same-origin',
            signal,
            cache: 'no-store',
            method: body === undefined ? 'GET' : 'POST',
            headers: body === undefined ? undefined : { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })

          if (!response.ok)
            throw new SessionRequestError({ message: 'Could not complete the session request.' })

          return response.json()
        },
        catch: () =>
          new SessionRequestError({ message: 'Could not complete the session request.' }),
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
        Effect.mapError(
          () => new SessionRequestError({ message: 'Could not complete the session request.' }),
        ),
      )

    return SessionService.of({
      search: (query) =>
        request(
          Schema.Struct({ users: Schema.Array(SessionUser) }),
          `list-users?${new URLSearchParams({ limit: '5', searchField: 'email', searchValue: query })}`,
        ).pipe(Effect.map(({ users }) => users)),
      list: (userId) =>
        request(
          Schema.Struct({
            sessions: Schema.Array(
              Schema.Struct({
                ...SessionMetadata.fields,
                token: Schema.String,
                userId: Schema.String,
              }),
            ),
          }),
          'list-user-sessions',
          { userId },
        ).pipe(
          Effect.map(({ sessions }) => {
            tokens.clear()

            return sessions.map(({ token, userId: owner, ...metadata }) => {
              tokens.set(metadata.id, { userId: owner, token })

              return metadata
            })
          }),
        ),
      revoke: (userId, sessionId) =>
        Effect.gen(function* () {
          if (sessionId === null) yield* request(Schema.Json, 'revoke-user-sessions', { userId })
          else {
            const session = tokens.get(sessionId)

            if (!session || session.userId !== userId)
              return yield* new SessionRequestError({
                message: 'Refresh the session list before revoking access.',
              })
            yield* request(Schema.Json, 'revoke-user-session', { sessionToken: session.token })
          }

          tokens.clear()

          return undefined
        }),
    })
  })

class SearchSessionUsers extends Query.Service<SearchSessionUsers>()(
  'dashboard/SearchSessionUsers',
  {
    args: { query: Schema.String, revision: Schema.Number },
    success: Schema.Array(SessionUser),
    error: SessionRequestError,
    staleTime: 0,
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* SessionService

      return ({ query }) => service.search(query)
    }),
  )
}

class ListSessions extends Query.Service<ListSessions>()('dashboard/ListSessions', {
  args: { userId: Schema.String, revision: Schema.Number },
  success: Schema.Array(SessionMetadata),
  error: SessionRequestError,
  staleTime: 0,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* SessionService

      return ({ userId }) => service.list(userId)
    }),
  )
}

export const SessionsMessage = UiSchema.TaggedEnum({
  UpdatedQuery: { value: Schema.String },
  ClickedSearch: {},
  PickedUser: { user: SessionUser },
  ClickedClear: {},
  ClickedRefresh: {},
  ClickedRevoke: { id: Schema.String },
  ClickedRevokeAll: {},
  ClickedConfirmAll: {},
  ClickedCancelAll: {},
  SucceededRevoke: { userId: Schema.String, revision: Schema.Number },
  FailedRevoke: { userId: Schema.String, revision: Schema.Number, message: Schema.String },
})

export class RevokeSession extends Command.Service<RevokeSession>()('dashboard/RevokeSession', {
  args: { userId: Schema.String, sessionId: Schema.NullOr(Schema.String), revision: Schema.Number },
  success: SessionsMessage,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* SessionService

      return ({ userId, sessionId, revision }) =>
        service.revoke(userId, sessionId).pipe(
          Effect.match({
            onSuccess: () => SessionsMessage.SucceededRevoke({ userId, revision }),
            onFailure: (error) =>
              SessionsMessage.FailedRevoke({ userId, revision, message: error.message }),
          }),
        )
    }),
  )
}

const SessionTable = (
  h: Html.H<typeof SessionsMessage.Type>,
  sessions: ReadonlyArray<typeof SessionMetadata.Type>,
  busy: boolean,
) => {
  if (sessions.length === 0) return h.p('No active sessions found.')

  return DataTable(h, 'Active sessions', [
    'Device',
    'IP address',
    'Created',
    'Expires',
    'Actions',
  ]).children(
    h.tbody.children(
      sessions.map((session) =>
        h.tr
          .key(session.id)
          .class('admin-row')
          .children(
            h.td(session.userAgent ?? 'Unknown device'),
            h.td(session.ipAddress ?? 'Unknown address'),
            h.td.children(
              Timestamp(h, { key: `${session.id}/created`, props: { iso: session.createdAt } }),
            ),
            h.td.children(
              Timestamp(h, { key: `${session.id}/expires`, props: { iso: session.expiresAt } }),
            ),
            h.td.children(
              h.button
                .disabled(busy)
                .on('click', SessionsMessage.ClickedRevoke({ id: session.id }))
                .children('Revoke session'),
            ),
          ),
      ),
    ),
  )
}

const SessionsDef = Html.component({
  name: 'DashboardSessions',
  model: Schema.Struct({
    query: Schema.String,
    searched: Schema.String,
    user: Schema.NullOr(SessionUser),
    revision: Schema.Number,
    busy: Schema.Boolean,
    confirming: Schema.Boolean,
    error: Schema.NullOr(Schema.String),
    notice: Schema.NullOr(Schema.String),
  }),
  message: SessionsMessage,
  restore: false,
  queries: {
    users: {
      query: SearchSessionUsers,
      args: ({ model }) =>
        model.searched ? { query: model.searched, revision: model.revision } : undefined,
    },
    sessions: {
      query: ListSessions,
      args: ({ model }) =>
        model.user ? { userId: model.user.id, revision: model.revision } : undefined,
    },
  },
})

export const DashboardSessionsNoDeps = SessionsDef.make({
  init: () => ({
    query: '',
    searched: '',
    user: null,
    revision: 0,
    busy: false,
    confirming: false,
    error: null,
    notice: null,
  }),
  update: {
    UpdatedQuery: ($, { value }) =>
      $.evolve({
        query: value,
        searched: '',
        user: null,
        revision: $.model.revision + 1,
        busy: false,
        confirming: false,
        error: null,
        notice: null,
      }),
    ClickedSearch: ($) =>
      $.model.busy
        ? $.model
        : $.evolve({ searched: $.model.query.trim(), revision: $.model.revision + 1 }),
    PickedUser: ($, { user }) =>
      $.model.busy
        ? $.model
        : $.evolve({
            user,
            revision: $.model.revision + 1,
            confirming: false,
            notice: null,
            error: null,
          }),
    ClickedClear: ($) =>
      $.model.busy ? $.model : $.evolve({ user: null, searched: '', confirming: false }),
    ClickedRefresh: ($) =>
      $.model.busy ? $.model : $.evolve({ revision: $.model.revision + 1, error: null }),
    ClickedRevoke: ($, { id }) =>
      !$.model.user ||
      $.model.busy ||
      !Predicate.isTagged($.queries.sessions, 'Success') ||
      !$.queries.sessions.value.some((session) => session.id === id)
        ? $.model
        : $.evolve({ busy: true, error: null }).run(
            RevokeSession.make({
              userId: $.model.user.id,
              sessionId: id,
              revision: $.model.revision,
            }),
          ),
    ClickedRevokeAll: ($) => ($.model.busy ? $.model : $.evolve({ confirming: true })),
    ClickedCancelAll: ($) => ($.model.busy ? $.model : $.evolve({ confirming: false })),
    ClickedConfirmAll: ($) =>
      !$.model.user || !$.model.confirming || $.model.busy
        ? $.model
        : $.evolve({ busy: true, error: null }).run(
            RevokeSession.make({
              userId: $.model.user.id,
              sessionId: null,
              revision: $.model.revision,
            }),
          ),
    SucceededRevoke: ($, { userId, revision }) =>
      userId !== $.model.user?.id || revision !== $.model.revision || !$.model.busy
        ? $.model
        : $.evolve({
            busy: false,
            confirming: false,
            revision: $.model.revision + 1,
            notice: 'Session access revoked.',
          }),
    FailedRevoke: ($, { userId, revision, message }) =>
      userId !== $.model.user?.id || revision !== $.model.revision || !$.model.busy
        ? $.model
        : $.evolve({ busy: false, error: message }),
  },
  view: (h, model) =>
    h.section.class('admin-page').children(
      h.p('Search for an account to inspect and revoke its sessions.'),
      Field(
        h,
        'search',
        'Search user by email',
        model.query,
        (value) => SessionsMessage.UpdatedQuery({ value }),
        'search',
      ),
      h.button
        .disabled(model.busy)
        .on('click', SessionsMessage.ClickedSearch())
        .children('Search users'),
      Predicate.isTagged(h.queries.users, 'Success')
        ? h.ul.children(
            h.queries.users.value.map((user) =>
              h.li
                .key(user.id)
                .children(
                  h.button
                    .attr('aria-label', `View sessions for ${user.email}`)
                    .disabled(model.busy)
                    .on('click', SessionsMessage.PickedUser({ user }))
                    .children(`${user.name} · ${user.email}`),
                ),
            ),
          )
        : undefined,
      Notice(h, model.error, true),
      Notice(h, model.notice),
      Predicate.isTagged(h.queries.users, 'Failure') ||
        Predicate.isTagged(h.queries.sessions, 'Failure')
        ? h.p.attr('role', 'alert').children('Could not load session data. Refresh to try again.')
        : undefined,
      model.user
        ? h.div
            .key('selected-user')
            .children(
              h.h2(`${model.user.name} · ${model.user.email}`),
              h.button
                .disabled(model.busy)
                .on('click', SessionsMessage.ClickedClear())
                .children('Choose another account'),
              h.button
                .disabled(model.busy)
                .on('click', SessionsMessage.ClickedRefresh())
                .children('Refresh sessions'),
              h.button
                .disabled(model.busy)
                .on('click', SessionsMessage.ClickedRevokeAll())
                .children('Revoke all'),
              model.confirming
                ? h.div.children(
                    h.p('Sign this user out of every device? They will need to sign in again.'),
                    h.button
                      .disabled(model.busy)
                      .on('click', SessionsMessage.ClickedConfirmAll())
                      .children('Confirm revoke all'),
                    h.button
                      .disabled(model.busy)
                      .on('click', SessionsMessage.ClickedCancelAll())
                      .children('Cancel'),
                  )
                : undefined,
              Predicate.isTagged(h.queries.sessions, 'Success')
                ? SessionTable(h, h.queries.sessions.value, model.busy)
                : h.p.attr('role', 'status').children('Loading sessions…'),
            )
        : undefined,
    ),
})

export const DashboardSessions = DashboardSessionsNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(SearchSessionUsers.layer, ListSessions.layer, RevokeSession.layer).pipe(
      Layer.provide(makeSessionServiceLayer()),
    ),
  ),
)
