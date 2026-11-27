import { Command, Component, Mount, Query, UiSchema } from '@effect/ui'
import { Dialog } from '@effect/ui-kit/Dialog'
import { Html } from '@effect/ui/html'
import { IssueKeyInput } from '@gbfm/api/personal-access-keys'
import { canAuthorWithKey, canPublishWithKey, KeyId } from '@gbfm/core/personal-access-keys'
import { isRole } from '@gbfm/core/roles'
import { Effect, Layer, Predicate, Queue, Redacted, Schema, Stream } from 'effect'

import { Principal } from '../../domain/principal'
import { createIssuanceState } from '../../page/dashboard/page/api-keys/issuance-state'
import {
  KeyPage,
  KeyRequestError,
  KeyService,
  KeyServiceLive,
} from '../../page/dashboard/page/api-keys/service'
import { AllowPasswordManager } from './password-manager'
import { Notice } from './presentation'

export const ApiKeysMessage = UiSchema.TaggedEnum({
  ClickedRefresh: { offset: Schema.Number },
  ClickedRevoke: { id: KeyId },
  ClickedCancelRevoke: {},
  ClickedConfirmRevoke: {},
  SucceededRevoke: {},
  FailedRevoke: { message: Schema.String },
  RequestedPassword: {},
  StartedVerification: {},
  FailedVerification: { message: Schema.String },
  CancelledPassword: {},
  HiddenPage: {},
  SettledPassword: { open: Schema.Boolean },
  IssuedKey: { discarded: Schema.Boolean },
})

const StartKeyListing = Mount.make('StartKeyListing', { args: {} }, () =>
  Effect.succeed(ApiKeysMessage.ClickedRefresh({ offset: 0 })),
)

class ListKeys extends Query.Service<ListKeys>()('dashboard/ListKeys', {
  args: { principalId: Schema.String, offset: Schema.Number, revision: Schema.Number },
  success: KeyPage,
  error: KeyRequestError,
  staleTime: 0,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* KeyService

      return ({ offset }) => service.list(offset)
    }),
  )
}

export class RevokeKey extends Command.Service<RevokeKey>()('dashboard/RevokeKey', {
  args: { id: KeyId },
  success: ApiKeysMessage,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* KeyService

      return ({ id }) =>
        service.revoke(id).pipe(
          Effect.match({
            onSuccess: () => ApiKeysMessage.SucceededRevoke(),
            onFailure: (error) => ApiKeysMessage.FailedRevoke({ message: error.message }),
          }),
        )
    }),
  )
}

export const IssueKey = Mount.makeStream(
  'IssueKey',
  {
    args: {
      userId: Schema.String,
      passwordOpen: Schema.Boolean,
      focusSecret: Schema.Boolean,
      focusPassword: Schema.Boolean,
    },
  },
  (element: HTMLElement, args, changes) =>
    Stream.callback<typeof ApiKeysMessage.Type, never, KeyService>((messages) =>
      Effect.gen(function* () {
        const service = yield* KeyService
        const form = element.querySelector('[data-key-create-form]')
        const host = element.querySelector('[data-key-secret]')
        const status = element.querySelector('[data-key-status]')
        const button = form?.querySelector('button[type="submit"]')

        if (
          !(form instanceof HTMLFormElement) ||
          !(host instanceof HTMLElement) ||
          !(status instanceof HTMLElement) ||
          !(button instanceof HTMLButtonElement)
        )
          return
        const lifecycle = createIssuanceState()
        lifecycle.setLive(true)

        const requests = yield* Queue.unbounded<
          FormData | { readonly password: Redacted.Redacted } | 'clear' | 'copy'
        >()

        const emit = (message: typeof ApiKeysMessage.Type) => Queue.offerUnsafe(messages, message)

        const clear = () => {
          lifecycle.clear()
          host.querySelectorAll('input').forEach((input) => {
            input.value = ''
          })
          host.replaceChildren()
          element.querySelectorAll('input[type="password"]').forEach((input) => {
            if (input instanceof HTMLInputElement) input.value = ''
          })
          button.disabled = !lifecycle.live() || lifecycle.verifying()
        }

        const submitted = (event: Event) => {
          if (!(event.target instanceof HTMLFormElement)) return
          const target = event.target

          if (target.matches('[data-key-password-form]')) {
            event.preventDefault()
            const password = target.querySelector('input[type="password"]')

            if (!(password instanceof HTMLInputElement) || !password.value || !lifecycle.verify())
              return
            const value = Redacted.make(password.value)
            password.value = ''
            Queue.offerUnsafe(requests, { password: value })
          } else if (target === form) {
            event.preventDefault()

            if (!lifecycle.submit()) return
            button.disabled = true
            Queue.offerUnsafe(requests, new FormData(form))
          }
        }

        const clicked = (event: Event) => {
          if (!(event.target instanceof Element)) return

          if (event.target.closest('[data-key-dismiss]')) Queue.offerUnsafe(requests, 'clear')

          if (event.target.closest('[data-key-copy]')) Queue.offerUnsafe(requests, 'copy')
        }

        const hidden = () => {
          lifecycle.setLive(false)
          clear()
          emit(ApiKeysMessage.HiddenPage())
        }

        const shown = () => {
          lifecycle.setLive(true)
          button.disabled = lifecycle.verifying()
        }

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            element.addEventListener('submit', submitted)
            element.addEventListener('click', clicked)
            window.addEventListener('pagehide', hidden)
            window.addEventListener('pageshow', shown)
            button.disabled = false
          }),
          () =>
            Effect.sync(() => {
              lifecycle.setLive(false)
              clear()
              element.removeEventListener('submit', submitted)
              element.removeEventListener('click', clicked)
              window.removeEventListener('pagehide', hidden)
              window.removeEventListener('pageshow', shown)
            }),
        )
        yield* changes.pipe(
          Stream.runForEach((next) =>
            Effect.sync(() => {
              if (!next.passwordOpen && !lifecycle.secret()) clear()

              if (next.focusPassword) {
                const password = element.querySelector('input[type="password"]')

                if (password instanceof HTMLInputElement) password.focus()
              }

              if (next.focusSecret && lifecycle.live()) {
                const output = host.querySelector('input')

                if (lifecycle.secret() && output instanceof HTMLInputElement) {
                  output.focus()
                  output.select()
                } else if (!lifecycle.busy() && !lifecycle.verifying()) button.focus()
              }
            }),
          ),
          Effect.forkScoped,
        )
        yield* Stream.fromQueue(requests).pipe(
          Stream.runForEach((request) =>
            Effect.gen(function* () {
              if (request === 'clear') {
                clear()
                status.textContent = 'Secret dismissed. It cannot be shown again.'
                button.focus()

                return
              }

              if (request === 'copy') {
                const secret = lifecycle.secret()

                if (!secret) return
                yield* Effect.tryPromise(() =>
                  navigator.clipboard.writeText(Redacted.value(secret)),
                ).pipe(
                  Effect.match({
                    onSuccess: () => {
                      status.textContent = 'Key copied. Store it securely.'
                    },
                    onFailure: () => {
                      status.textContent = 'Could not copy. Select the secret and copy it manually.'
                    },
                  }),
                )

                return
              }

              if (request instanceof FormData) {
                yield* Schema.decodeUnknownEffect(IssueKeyInput)({
                  requestId: crypto.randomUUID(),
                  name: request.get('name'),
                  scopes: request.getAll('scopes'),
                  expiresInSeconds: Number(request.get('expiresInSeconds')),
                }).pipe(
                  Effect.match({
                    onSuccess: (input) => {
                      lifecycle.requestPassword(input)
                      emit(ApiKeysMessage.RequestedPassword())
                    },
                    onFailure: () => {
                      clear()
                      status.textContent =
                        'Enter a name of up to 80 characters and select permissions. Publishing also requires create or update permission.'
                    },
                  }),
                )

                return
              }

              const input = lifecycle.input()

              if (!input || !lifecycle.live()) return
              emit(ApiKeysMessage.StartedVerification())
              yield* service.confirmPassword(args.userId, request.password).pipe(
                Effect.flatMap(() =>
                  lifecycle.input() === input && lifecycle.live()
                    ? service.issue(input)
                    : Effect.succeed(null),
                ),
                Effect.match({
                  onFailure: (error) => {
                    lifecycle.verificationFailed()
                    emit(ApiKeysMessage.FailedVerification({ message: error.message }))
                    const password = element.querySelector('input[type="password"]')

                    if (password instanceof HTMLInputElement) password.focus()
                  },
                  onSuccess: (issued) => {
                    lifecycle.issued(issued?.secret ?? null)
                    const secret = lifecycle.secret()

                    if (!issued) {
                      emit(
                        ApiKeysMessage.FailedVerification({
                          message: 'Confirmation was cancelled. Close this dialog and try again.',
                        }),
                      )

                      return
                    }

                    if (secret) {
                      const label = document.createElement('label')
                      label.textContent = 'New API key secret'
                      const output = document.createElement('input')
                      output.readOnly = true
                      output.autocomplete = 'off'
                      output.value = Redacted.value(secret)
                      label.append(output)
                      const copy = document.createElement('button')
                      copy.type = 'button'
                      copy.dataset.keyCopy = ''
                      copy.textContent = 'Copy key'
                      const dismiss = document.createElement('button')
                      dismiss.type = 'button'
                      dismiss.dataset.keyDismiss = ''
                      dismiss.textContent = 'I saved my key'
                      host.replaceChildren(label, copy, dismiss)
                      output.focus()
                      output.select()
                    }

                    status.textContent = secret
                      ? 'Key created.'
                      : 'A key was issued after this confirmation was cleared. Revoke it from the list and create a replacement.'
                    emit(ApiKeysMessage.IssuedKey({ discarded: secret === null }))
                  },
                }),
              )
            }),
          ),
          Effect.forkScoped,
        )

        yield* Effect.never
      }),
    ),
)

const ApiKeysDef = Html.component({
  name: 'DashboardApiKeys',
  props: Schema.Struct({ principal: Principal }),
  model: Schema.Struct({
    offset: Schema.Number,
    revision: Schema.Number,
    busy: Schema.Boolean,
    confirming: Schema.NullOr(KeyId),
    passwordOpen: Schema.Boolean,
    verifying: Schema.Boolean,
    focusSecret: Schema.Boolean,
    error: Schema.NullOr(Schema.String),
    notice: Schema.NullOr(Schema.String),
  }),
  message: ApiKeysMessage,
  restore: false,
  queries: {
    keys: {
      query: ListKeys,
      args: ({ model, props }) =>
        model.revision > 0
          ? { principalId: props.principal.id, offset: model.offset, revision: model.revision }
          : undefined,
    },
  },
})

export const DashboardApiKeysNoDeps = ApiKeysDef.make({
  init: () => ({
    offset: 0,
    revision: 0,
    busy: false,
    confirming: null,
    passwordOpen: false,
    verifying: false,
    focusSecret: false,
    error: null,
    notice: null,
  }),
  update: {
    ClickedRefresh: ($, { offset }) =>
      $.model.busy
        ? $.model
        : $.evolve({ offset, revision: $.model.revision + 1, confirming: null, error: null }),
    ClickedRevoke: ($, { id }) =>
      $.model.busy ||
      !Predicate.isTagged($.queries.keys, 'Success') ||
      !$.queries.keys.value.data.some((key) => key.id === id && !key.revokedAt)
        ? $.model
        : $.evolve({ confirming: id }),
    ClickedCancelRevoke: ($) => $.evolve({ confirming: null }),
    ClickedConfirmRevoke: ($) =>
      !$.model.confirming || $.model.busy
        ? $.model
        : $.evolve({ busy: true }).run(RevokeKey.make({ id: $.model.confirming })),
    SucceededRevoke: ($) =>
      $.evolve({
        busy: false,
        confirming: null,
        revision: $.model.revision + 1,
        notice: 'Key revoked.',
      }),
    FailedRevoke: ($, { message }) => $.evolve({ busy: false, error: message }),
    RequestedPassword: ($) =>
      $.evolve({ passwordOpen: true, focusSecret: false, error: null, notice: null }),
    StartedVerification: ($) => $.evolve({ verifying: true, error: null }),
    FailedVerification: ($, { message }) => $.evolve({ verifying: false, error: message }),
    CancelledPassword: ($) =>
      $.model.verifying ? $.model : $.evolve({ passwordOpen: false, error: null }),
    HiddenPage: ($) => $.evolve({ passwordOpen: false, focusSecret: false, error: null }),
    SettledPassword: ($, { open }) => $.evolve({ focusSecret: !open }),
    IssuedKey: ($, { discarded }) =>
      $.evolve({
        offset: 0,
        passwordOpen: false,
        verifying: false,
        revision: $.model.revision + 1,
        notice: discarded
          ? 'A key was issued after this confirmation was cleared. Revoke it from the list and create a replacement.'
          : 'Key created. Save the secret below before leaving this page.',
      }),
  },
  view: (h, model) => {
    const role = h.props.principal.role
    const validRole = role && isRole(role) ? role : null
    const page = Predicate.isTagged(h.queries.keys, 'Success') ? h.queries.keys.value : null

    const scopes = [
      { value: 'posts:read', label: 'Read your posts' },
      { value: 'posts:create', label: 'Create drafts' },
      { value: 'posts:update', label: 'Update drafts' },
      ...(canPublishWithKey(validRole)
        ? [{ value: 'posts:publish', label: 'Publish and change published posts' }]
        : []),
    ]

    return h.section
      .class('admin-page')
      .onMount(
        IssueKey({
          userId: h.props.principal.id,
          passwordOpen: model.passwordOpen,
          focusSecret: model.focusSecret,
          focusPassword: model.passwordOpen && !model.verifying && model.error !== null,
        }),
      )
      .children(
        h.p(
          'Keys give scripts access to your own posts, not music resolution, image uploads or account management.',
        ),
        h.div.key('key-notices').children(Notice(h, model.error, true), Notice(h, model.notice)),
        canAuthorWithKey(validRole)
          ? h.form
              .key('key-create-form')
              .attr('data-key-create-form', '')
              .attr('inert', model.passwordOpen ? '' : undefined)
              .class('dashboard-panel dashboard-form')
              .children(
                h.h2('Create API key'),
                h.p(
                  'Confirm your password to create a key. Up to 10 active keys, expiring after at most 90 days.',
                ),
                h.label.children(
                  'Name',
                  h.input
                    .attr('name', 'name')
                    .attr('required', '')
                    .attr('maxlength', '80')
                    .attr('autocomplete', 'off'),
                ),
                h.fieldset.children(
                  h.legend('Permissions'),
                  scopes.map((scope) =>
                    h.label.children(
                      h.input
                        .attr('type', 'checkbox')
                        .attr('name', 'scopes')
                        .attr('value', scope.value),
                      scope.label,
                    ),
                  ),
                ),
                h.label.children(
                  'Expires after',
                  h.select.attr('name', 'expiresInSeconds').children(
                    [
                      ['2592000', '30 days'],
                      ['3600', '1 hour'],
                      ['86400', '1 day'],
                      ['604800', '7 days'],
                      ['7776000', '90 days'],
                    ].map(([value, label]) => h.option.attr('value', value).children(label)),
                  ),
                ),
                h.button.attr('type', 'submit').disabled(true).children('Create key'),
                h.p.attr('data-key-status', '').attr('role', 'status'),
                h.div.attr('data-key-secret', '').class('dashboard-form'),
              )
          : h.p(
              'Creator access is required to create API keys. You can still view and revoke existing keys.',
            ),
        Dialog(h, {
          props: { open: model.passwordOpen, disablePointerDismissal: true },
          onEmit: (event) => {
            if (Predicate.isTagged(event, 'Settled'))
              return ApiKeysMessage.SettledPassword({ open: event.open })

            return undefined
          },
          view: (dialog) =>
            h.div
              .key('key-password-dialog')
              .onMount(AllowPasswordManager({ open: model.passwordOpen }))
              .children(
                dialog.portal(h.dialog.class('key-password-portal'))?.children(
                  dialog.backdrop(h.div)?.class('dialog-backdrop'),
                  dialog
                    .viewport(h.div)
                    .class('dialog-viewport')
                    .children(
                      dialog
                        .popup(h.div)
                        .class('dialog-panel')
                        .children(
                          dialog.title(h.h2).children('Confirm your password'),
                          dialog
                            .description(h.p)
                            .children('Verify your password before creating this API key.'),
                          h.form
                            .attr('data-key-password-form', '')
                            .on(
                              'keydown',
                              ({ key, composing }) =>
                                key === 'Escape' && !composing
                                  ? ApiKeysMessage.CancelledPassword()
                                  : undefined,
                              { preventDefault: true },
                            )
                            .class('dashboard-form')
                            .children(
                              h.label.children(
                                'Password',
                                dialog
                                  .initialFocus(h.input)
                                  .attr('type', 'password')
                                  .attr('name', 'password')
                                  .attr('autocomplete', 'current-password')
                                  .attr('required', '')
                                  .disabled(model.verifying),
                              ),
                              Notice(h, model.error, true),
                              h.button
                                .attr('type', 'submit')
                                .disabled(model.verifying)
                                .children(
                                  model.verifying ? 'Verifying…' : 'Confirm and create key',
                                ),
                              dialog
                                .close(h.button)
                                .disabled(model.verifying)
                                .on('click', ApiKeysMessage.CancelledPassword())
                                .children('Cancel'),
                            ),
                        ),
                    ),
                ),
              ),
        }),
        h.h2.key('key-list-title').onMount(StartKeyListing({})).children('Your API keys'),
        h.button
          .on('click', ApiKeysMessage.ClickedRefresh({ offset: model.offset }))
          .disabled(model.busy)
          .children('Refresh keys'),
        Predicate.isTagged(h.queries.keys, 'Failure')
          ? h.p.attr('role', 'alert').children('Could not load API keys. Refresh to try again.')
          : undefined,
        page?.data.length === 0 ? h.p('No API keys yet.') : undefined,
        page?.data.map((key) =>
          h.article
            .key(key.id)
            .class('dashboard-panel')
            .children(
              h.h3(key.name),
              h.code(`${key.displayPrefix}…`),
              h.p(key.scopes.join(', ')),
              h.p(`Created ${key.createdAt} · Expires ${key.expiresAt}`),
              h.p(key.lastUsedAt ? `Last used ${key.lastUsedAt}` : 'Not used yet'),
              key.revokedAt
                ? h.p(`Revoked ${key.revokedAt}`)
                : h.div.children(
                    model.confirming === key.id
                      ? [
                          h.p(
                            `Revoke "${key.name}"? Scripts using it will immediately lose access.`,
                          ),
                          h.button
                            .disabled(model.busy)
                            .on('click', ApiKeysMessage.ClickedConfirmRevoke())
                            .children('Confirm revoke'),
                          h.button
                            .disabled(model.busy)
                            .on('click', ApiKeysMessage.ClickedCancelRevoke())
                            .children('Keep key'),
                        ]
                      : h.button
                          .disabled(model.busy)
                          .on('click', ApiKeysMessage.ClickedRevoke({ id: key.id }))
                          .children('Revoke key'),
                  ),
            ),
        ),
        page
          ? h.nav.attr('aria-label', 'API key pages').children(
              h.button
                .disabled(model.busy || model.offset === 0)
                .on(
                  'click',
                  ApiKeysMessage.ClickedRefresh({ offset: Math.max(0, model.offset - 20) }),
                )
                .children('Previous'),
              h.span(`${page.pagination.total} keys`),
              h.button
                .disabled(model.busy || !page.pagination.hasMore)
                .on('click', ApiKeysMessage.ClickedRefresh({ offset: model.offset + 20 }))
                .children('Next'),
            )
          : undefined,
      )
  },
})

export const apiKeyOperationsLayer = Layer.mergeAll(ListKeys.layer, RevokeKey.layer)

export const DashboardApiKeys = DashboardApiKeysNoDeps.pipe(
  Component.provide(apiKeyOperationsLayer.pipe(Layer.provideMerge(KeyServiceLive))),
)
