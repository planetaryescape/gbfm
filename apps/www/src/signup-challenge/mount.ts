import { Effect, Queue, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'

import { Message } from '../message'
import { Action, type Status } from './model'
import { startSignupChallenge } from './runtime'

interface Turnstile {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string
      action: string
      appearance: 'interaction-only'
      'response-field': false
      callback: (token: string) => void
      'error-callback': () => void
      'expired-callback': () => void
      'timeout-callback': () => void
    },
  ) => string
  remove: (id: string) => void
  reset: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

/** The runtime owns the script, widget, native form listeners and in-flight request. */
export const SignupChallenge = Mount.defineStream('SignupChallenge', {
  args: { sitekey: Schema.String, action: Action },
  messages: [Message.ChallengeStatusChanged],
  execute: ({ element, sitekey, action }) =>
    Stream.callback<typeof Message.ChallengeStatusChanged.Type>((queue) =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            if (!(element instanceof HTMLFormElement)) return () => {}

            const host = element.querySelector<HTMLElement>('[data-turnstile]')

            if (!host) return () => {}

            const status = (value: Status) => {
              Queue.offerUnsafe(queue, Message.ChallengeStatusChanged({ status: value }))
            }

            const runtime = startSignupChallenge({
              sitekey,
              action,
              status,
              widget: () => {
                const api = window.turnstile

                return api
                  ? {
                      render: (options) => api.render(host, options),
                      reset: (id) => api.reset(id),
                      remove: (id) => api.remove(id),
                    }
                  : undefined
              },
              loadScript: (onLoad, fail) => {
                const script = document.createElement('script')

                const loaded = () => {
                  clearTimeout(loadTimeout)
                  onLoad()
                }

                script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
                script.async = true
                script.addEventListener('load', loaded)
                script.addEventListener('error', fail)
                const loadTimeout = setTimeout(fail, 15_000)
                document.head.append(script)

                return () => {
                  clearTimeout(loadTimeout)
                  script.removeEventListener('load', loaded)
                  script.removeEventListener('error', fail)
                  script.remove()
                }
              },
              prepare: (token, signal) => {
                const body = new FormData(element)
                body.set('cf-turnstile-response', token)

                return () => fetch(element.action, { method: 'POST', body, signal })
              },
              redirect: (url) => window.location.assign(url),
            })

            const retry = (event: Event) => {
              if (
                !(event.target instanceof Element) ||
                !event.target.closest('[data-challenge-retry]')
              )
                return
              runtime.retry()
            }

            const submit = async (event: SubmitEvent) => {
              event.preventDefault()

              await runtime.submit()
            }

            element.addEventListener('click', retry)
            element.addEventListener('submit', submit)
            runtime.start()

            return () => {
              runtime.dispose()
              element.removeEventListener('click', retry)
              element.removeEventListener('submit', submit)
            }
          }),
          (cleanup) => Effect.sync(cleanup),
        )

        return yield* Effect.never
      }),
    ),
})
