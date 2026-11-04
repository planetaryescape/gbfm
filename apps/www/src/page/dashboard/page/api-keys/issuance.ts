import { IssueKeyInput } from '@gbfm/api/personal-access-keys'
import { Context, Effect, Layer, Queue, Redacted, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'

import { createIssuanceState } from './issuance-state'
import { Message } from './model'
import { showSecret } from './secret-display'
import { KeyService, KeyServiceLive } from './service'

export const IssueKey = Mount.defineStream('PersonalAccessKeys.Issue', {
  args: { userId: Schema.String },
  messages: [
    Message.Issued,
    Message.PasswordRequested,
    Message.PasswordCancelled,
    Message.PasswordVerificationStarted,
    Message.PasswordVerificationFailed,
  ],
  execute: ({ element, userId, viewStateChanges }) =>
    Stream.callback<
      | typeof Message.Issued.Type
      | typeof Message.PasswordRequested.Type
      | typeof Message.PasswordCancelled.Type
      | typeof Message.PasswordVerificationStarted.Type
      | typeof Message.PasswordVerificationFailed.Type
    >((messages) =>
      Effect.gen(function* () {
        const form = element.querySelector('[data-key-create-form]')

        if (!(form instanceof HTMLFormElement)) return yield* Effect.void
        const context = yield* Layer.build(KeyServiceLive)
        const service = Context.get(context, KeyService)

        const requests = yield* Queue.unbounded<
          FormData | { readonly password: Redacted.Redacted } | 'dismiss' | 'copy'
        >()

        const host = element.querySelector('[data-key-secret]')
        const status = element.querySelector('[data-key-status]')
        const submitButton = element.querySelector('button[type="submit"]')

        if (
          !(host instanceof HTMLElement) ||
          !(status instanceof HTMLElement) ||
          !(submitButton instanceof HTMLButtonElement)
        )
          return yield* Effect.void
        const lifecycle = createIssuanceState()

        const clear = () => {
          lifecycle.clear()
          submitButton.disabled = !lifecycle.live() || lifecycle.verifying()
          host.replaceChildren()
          const password = element.querySelector('input[type="password"]')

          if (password instanceof HTMLInputElement) password.value = ''
        }

        const submit = (event: Event) => {
          event.preventDefault()

          if (!lifecycle.live() || lifecycle.secret()) return

          if (
            event.target instanceof HTMLFormElement &&
            event.target.matches('[data-key-password-form]')
          ) {
            const password = event.target.querySelector('input[type="password"]')

            if (!(password instanceof HTMLInputElement) || !password.value || !lifecycle.verify())
              return
            const value = Redacted.make(password.value)
            password.value = ''
            Queue.offerUnsafe(requests, { password: value })

            return
          }

          if (event.target !== form || !lifecycle.submit()) return
          submitButton.disabled = true
          Queue.offerUnsafe(requests, new FormData(form))
        }

        const closed = (event: Event) => {
          if (
            !(event.target instanceof HTMLDialogElement) ||
            !event.target.matches('[data-key-password-dialog]') ||
            lifecycle.verifying() ||
            lifecycle.secret()
          )
            return
          lifecycle.clear()
          submitButton.disabled = !lifecycle.live()
          status.textContent = ''
        }

        const click = (event: Event) => {
          if (!lifecycle.live()) return

          if (!(event.target instanceof Element)) return

          if (event.target.closest('[data-key-dismiss]')) Queue.offerUnsafe(requests, 'dismiss')

          if (event.target.closest('[data-key-copy]')) Queue.offerUnsafe(requests, 'copy')
        }

        const keydown = (event: Event) => {
          if (
            !lifecycle.live() ||
            !(event instanceof KeyboardEvent) ||
            event.key !== 'Escape' ||
            event.defaultPrevented
          )
            return
          const target = event.composedPath()[0]

          if (
            !(target instanceof HTMLInputElement || target instanceof HTMLButtonElement) ||
            !target.form?.matches('[data-key-password-form]')
          )
            return
          event.preventDefault()
          event.stopPropagation()
          Queue.offerUnsafe(messages, Message.PasswordCancelled())
        }

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            element.addEventListener('submit', submit)
            element.addEventListener('click', click)
            element.addEventListener('keydown', keydown)
            element.addEventListener('close', closed, true)
            window.addEventListener('pagehide', clear)
          }),
          () =>
            Effect.sync(() => {
              clear()
              element.removeEventListener('submit', submit)
              element.removeEventListener('click', click)
              element.removeEventListener('keydown', keydown)
              element.removeEventListener('close', closed, true)
              window.removeEventListener('pagehide', clear)
            }),
        )

        yield* viewStateChanges.pipe(
          Stream.runForEach((state) =>
            Effect.sync(() => {
              lifecycle.setLive(state === 'Live')

              if (!lifecycle.live()) clear()
              submitButton.disabled =
                !lifecycle.live() || lifecycle.busy() || lifecycle.secret() !== null
            }),
          ),
          Effect.forkScoped,
        )

        yield* Stream.fromQueue(requests).pipe(
          Stream.runForEach((request) =>
            Effect.gen(function* () {
              if (request === 'dismiss') {
                clear()
                submitButton.disabled = false
                status.textContent = 'Secret dismissed. It cannot be shown again.'

                return
              }

              if (request === 'copy') {
                const value = lifecycle.secret()

                if (value)
                  yield* Effect.tryPromise(() =>
                    navigator.clipboard.writeText(Redacted.value(value)),
                  ).pipe(
                    Effect.match({
                      onSuccess: () => {
                        status.textContent = 'Key copied. Store it securely.'
                      },
                      onFailure: () => {
                        status.textContent =
                          'Could not copy. Select the secret and copy it manually.'
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
                  Effect.mapError(() => ({
                    message:
                      'Enter a name of up to 80 characters and select permissions. Publishing also requires create or update permission.',
                  })),
                  Effect.match({
                    onFailure: (error) => {
                      status.textContent = error.message
                      lifecycle.clear()
                      submitButton.disabled = false
                    },
                    onSuccess: (input) => {
                      lifecycle.requestPassword(input)
                      status.textContent = 'Confirm your password to create this key.'
                      Queue.offerUnsafe(messages, Message.PasswordRequested())
                    },
                  }),
                )

                return
              }

              const input = lifecycle.input()

              if (!input || !lifecycle.live()) return
              Queue.offerUnsafe(messages, Message.PasswordVerificationStarted())

              yield* service.confirmPassword(userId, request.password).pipe(
                Effect.flatMap(() =>
                  lifecycle.input() === input && lifecycle.live()
                    ? service.issue(input)
                    : Effect.succeed(null),
                ),
                Effect.match({
                  onFailure: (error) => {
                    lifecycle.verificationFailed()
                    status.textContent = 'Key not created.'
                    Queue.offerUnsafe(
                      messages,
                      Message.PasswordVerificationFailed({ message: error.message }),
                    )
                    const password = element.querySelector('input[type="password"]')

                    if (password instanceof HTMLInputElement) password.focus()
                  },
                  onSuccess: (issued) => {
                    lifecycle.issued(issued?.secret ?? null)

                    if (!issued) {
                      submitButton.disabled = !lifecycle.live()
                      Queue.offerUnsafe(
                        messages,
                        Message.PasswordVerificationFailed({
                          message: 'Confirmation was cancelled. Close this dialog and try again.',
                        }),
                      )

                      return
                    }

                    if (!lifecycle.live()) {
                      status.textContent =
                        'A key was issued while the view was paused. Revoke it from the list and create a replacement.'
                      Queue.offerUnsafe(messages, Message.Issued())

                      return
                    }

                    showSecret(host, issued.secret)
                    status.textContent = 'Key created.'
                    Queue.offerUnsafe(messages, Message.Issued())
                  },
                }),
              )
            }),
          ),
          Effect.forkScoped,
        )

        return yield* Effect.never
      }),
    ),
})
