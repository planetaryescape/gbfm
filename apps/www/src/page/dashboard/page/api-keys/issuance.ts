import { IssueKeyInput } from '@gbfm/api/personal-access-keys'
import { Context, Effect, Layer, Queue, Redacted, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'

import { Message } from './model'
import { KeyService, KeyServiceLive } from './service'

export const IssueKey = Mount.defineStream('PersonalAccessKeys.Issue', {
  messages: [Message.Issued],
  execute: ({ element, viewStateChanges }) =>
    Stream.callback<typeof Message.Issued.Type>((messages) =>
      Effect.gen(function* () {
        if (!(element instanceof HTMLFormElement)) return
        const context = yield* Layer.build(KeyServiceLive)
        const service = Context.get(context, KeyService)
        const requests = yield* Queue.unbounded<FormData | 'dismiss' | 'copy'>()
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

        const clear = () => {
          secret = null
          host.replaceChildren()
        }

        const submit = (event: SubmitEvent) => {
          event.preventDefault()

          if (!live || busy || secret) return
          busy = true
          submitButton.disabled = true
          status.textContent = 'Creating key…'
          Queue.offerUnsafe(requests, new FormData(element))
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
            window.addEventListener('pagehide', clear)
          }),
          () =>
            Effect.sync(() => {
              clear()
              element.removeEventListener('submit', submit)
              element.removeEventListener('click', click)
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
                Effect.flatMap((input) => service.issue(input)),
                Effect.match({
                  onFailure: (error) => {
                    status.textContent = error.message
                    busy = false
                    submitButton.disabled = false
                  },
                  onSuccess: (issued) => {
                    secret = issued.secret
                    const label = document.createElement('label')
                    label.textContent = 'New API key secret'
                    const input = document.createElement('input')
                    input.readOnly = true
                    input.autocomplete = 'off'
                    input.spellcheck = false
                    input.value = Redacted.value(issued.secret)
                    label.append(input)
                    const warning = document.createElement('p')
                    warning.textContent =
                      'Copy this now. It is shown only once and disappears when you leave this page.'
                    const copy = document.createElement('button')
                    copy.type = 'button'
                    copy.className = 'btn btn-secondary'
                    copy.dataset.keyCopy = ''
                    copy.textContent = 'Copy key'
                    const dismiss = document.createElement('button')
                    dismiss.type = 'button'
                    dismiss.className = 'btn btn-quiet'
                    dismiss.dataset.keyDismiss = ''
                    dismiss.textContent = 'I saved my key'

                    if (!live) {
                      secret = null
                      busy = false
                      status.textContent =
                        'A key was issued while the view was paused. Revoke it from the list and create a replacement.'
                      Queue.offerUnsafe(messages, Message.Issued())

                      return
                    }

                    host.replaceChildren(warning, label, copy, dismiss)
                    status.textContent = 'Key created.'
                    busy = false
                    Queue.offerUnsafe(messages, Message.Issued())
                    input.focus()
                    input.select()
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
