import { Mount, UiSchema } from '@effect/ui'
import { Effect, Queue, Schema, Stream } from 'effect'

import { Action, Status } from '../../domain/auth/challenge'
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

export const ChallengeMessage = UiSchema.TaggedEnum({ ChangedChallengeStatus: { status: Status } })

export const SignupChallenge = Mount.makeStream(
  'SignupChallenge',
  {
    args: { sitekey: Schema.String, action: Action },
  },
  (element: HTMLFormElement, _args, changes) =>
    Stream.switchMap(changes, ({ sitekey, action }) =>
      Stream.callback<typeof ChallengeMessage.Type>((queue) =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const host = element.querySelector<HTMLElement>('[data-turnstile]')

              if (!host) return () => {}

              const runtime = startSignupChallenge({
                sitekey,
                action,
                status: (status) => {
                  Queue.offerUnsafe(queue, ChallengeMessage.ChangedChallengeStatus({ status }))
                },
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
                    clearTimeout(timeout)
                    onLoad()
                  }

                  script.src =
                    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
                  script.async = true
                  script.addEventListener('load', loaded)
                  script.addEventListener('error', fail)
                  const timeout = setTimeout(fail, 15_000)
                  document.head.append(script)

                  return () => {
                    clearTimeout(timeout)
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
                  event.target instanceof Element &&
                  event.target.closest('[data-challenge-retry]')
                )
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
    ),
)
