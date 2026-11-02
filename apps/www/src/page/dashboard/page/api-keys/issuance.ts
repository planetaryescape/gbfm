import { IssueKeyInput } from '@gbfm/api/personal-access-keys'
import { Context, Effect, Layer, Queue, Redacted, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'

import { Message } from './model'
import { showSecret } from './secret-display'
import { KeyService, KeyServiceLive } from './service'

export const IssueKey = Mount.defineStream('PersonalAccessKeys.Issue', {
  args: { userId: Schema.String },
  messages: [
    Message.Issued,
    Message.PasswordRequested,
    Message.PasswordVerificationStarted,
    Message.PasswordVerificationFailed,
  ],
  execute: ({ element, userId, viewStateChanges }) =>
    Stream.callback<
      | typeof Message.Issued.Type
      | typeof Message.PasswordRequested.Type
      | typeof Message.PasswordVerificationStarted.Type
      | typeof Message.PasswordVerificationFailed.Type
    >((messages) =>
      Effect.gen(function* () {
        const form = element.querySelector('[data-key-create-form]')

        if (!(form instanceof HTMLFormElement)) return
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
          return
        let busy = false
        let live = false
        let secret: Redacted.Redacted | null = null
        let pending: IssueKeyInput | null = null
        let verifying = false

        const clear = () => {
          secret = null
          pending = null
          busy = false
          submitButton.disabled = !live || verifying
          host.replaceChildren()
          const password = element.querySelector('input[type="password"]')

          if (password instanceof HTMLInputElement) password.value = ''
        }

        const submit = (event: Event) => {
          event.preventDefault()

          if (!live || secret) return

          if (
            event.target instanceof HTMLFormElement &&
            event.target.matches('[data-key-password-form]')
          ) {
            const password = event.target.querySelector('input[type="password"]')

            if (!pending || verifying || !(password instanceof HTMLInputElement) || !password.value)
              return
            verifying = true
            const value = Redacted.make(password.value)
            password.value = ''
            Queue.offerUnsafe(requests, { password: value })

            return
          }

          if (event.target !== form || busy) return
          busy = true
          submitButton.disabled = true
          Queue.offerUnsafe(requests, new FormData(form))
        }

        const closed = (event: Event) => {
          if (
            !(event.target instanceof HTMLDialogElement) ||
            !event.target.matches('[data-key-password-dialog]') ||
            verifying ||
            secret
          )
            return
          pending = null
          busy = false
          submitButton.disabled = !live
          status.textContent = ''
        }

        const click = (event: Event) => {
          if (!live) return

          if (!(event.target instanceof Element)) return

          if (event.target.closest('[data-key-dismiss]')) Queue.offerUnsafe(requests, 'dismiss')

          if (event.target.closest('[data-key-copy]')) Queue.offerUnsafe(requests, 'copy')
        }

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            element.addEventListener('submit', submit)
            element.addEventListener('click', click)
            element.addEventListener('close', closed, true)
            window.addEventListener('pagehide', clear)
          }),
          () =>
            Effect.sync(() => {
              clear()
              element.removeEventListener('submit', submit)
              element.removeEventListener('click', click)
              element.removeEventListener('close', closed, true)
              window.removeEventListener('pagehide', clear)
            }),
        )

        yield* viewStateChanges.pipe(
          Stream.runForEach((state) =>
            Effect.sync(() => {
              live = state === 'Live'

              if (!live) clear()
              submitButton.disabled = !live || busy || secret !== null
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
                const value = secret

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
                      busy = false
                      submitButton.disabled = false
                    },
                    onSuccess: (input) => {
                      pending = input
                      status.textContent = 'Confirm your password to create this key.'
                      Queue.offerUnsafe(messages, Message.PasswordRequested())
                    },
                  }),
                )

                return
              }

              const input = pending

              if (!input || !live) return
              Queue.offerUnsafe(messages, Message.PasswordVerificationStarted())

              yield* service.confirmPassword(userId, request.password).pipe(
                Effect.flatMap(() =>
                  pending === input && live ? service.issue(input) : Effect.succeed(null),
                ),
                Effect.match({
                  onFailure: (error) => {
                    verifying = false
                    status.textContent = 'Key not created.'
                    Queue.offerUnsafe(
                      messages,
                      Message.PasswordVerificationFailed({ message: error.message }),
                    )
                    const password = element.querySelector('input[type="password"]')

                    if (password instanceof HTMLInputElement) password.focus()
                  },
                  onSuccess: (issued) => {
                    verifying = false
                    pending = null

                    if (!issued) {
                      busy = false
                      submitButton.disabled = !live
                      Queue.offerUnsafe(
                        messages,
                        Message.PasswordVerificationFailed({
                          message: 'Confirmation was cancelled. Close this dialog and try again.',
                        }),
                      )

                      return
                    }

                    secret = issued.secret

                    if (!live) {
                      secret = null
                      busy = false
                      status.textContent =
                        'A key was issued while the view was paused. Revoke it from the list and create a replacement.'
                      Queue.offerUnsafe(messages, Message.Issued())

                      return
                    }

                    showSecret(host, issued.secret)
                    status.textContent = 'Key created.'
                    busy = false
                    Queue.offerUnsafe(messages, Message.Issued())
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
})
