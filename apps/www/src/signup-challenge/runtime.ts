import { Data } from 'effect'

import type { Action, Status } from './model'

export interface ChallengeWidget {
  readonly render: (options: {
    readonly sitekey: string
    readonly action: typeof Action.Type
    readonly appearance: 'interaction-only'
    readonly 'response-field': false
    readonly callback: (token: string) => void
    readonly 'error-callback': () => void
    readonly 'expired-callback': () => void
    readonly 'timeout-callback': () => void
  }) => string
  readonly reset: (id: string) => void
  readonly remove: (id: string) => void
}

type Challenge =
  | { readonly _tag: 'Waiting' }
  | { readonly _tag: 'Ready'; readonly token: string }
  | { readonly _tag: 'Disposed' }

const Challenge = Data.taggedEnum<Challenge>()

export const startSignupChallenge = (input: {
  readonly sitekey: string
  readonly action: typeof Action.Type
  readonly widget: () => ChallengeWidget | undefined
  readonly loadScript: (loaded: () => void, failed: () => void) => () => void
  readonly status: (status: Status) => void
  readonly prepare: (token: string, signal: AbortSignal) => () => Promise<Response>
  readonly redirect: (url: string) => void
}) => {
  let challenge: Challenge = Challenge.Waiting()
  let challengeGeneration = 0
  let widget: string | undefined
  let unloadScript: (() => void) | undefined
  let submitting = false
  const controller = new AbortController()

  const status = (value: Status) => {
    if (!Challenge.$is('Disposed')(challenge)) input.status(value)
  }

  const fail = () => {
    if (!Challenge.$is('Disposed')(challenge)) {
      challengeGeneration += 1
      challenge = Challenge.Waiting()
    }

    status('failed')
  }

  const render = () => {
    const api = input.widget()

    if (Challenge.$is('Disposed')(challenge) || !api || widget !== undefined) return

    try {
      widget = api.render({
        sitekey: input.sitekey,
        action: input.action,
        appearance: 'interaction-only',
        'response-field': false,
        callback: (token) => {
          if (Challenge.$is('Disposed')(challenge)) return
          challengeGeneration += 1
          challenge = Challenge.Ready({ token })
          status('ready')
        },
        'error-callback': fail,
        'expired-callback': fail,
        'timeout-callback': fail,
      })
    } catch {
      fail()
    }
  }

  const load = () => {
    unloadScript?.()
    unloadScript = input.loadScript(() => {
      if (input.widget()) render()
      else fail()
    }, fail)
  }

  return {
    start() {
      status(input.sitekey ? 'verifying' : 'unavailable')

      if (input.sitekey) {
        if (input.widget()) render()
        else load()
      }
    },
    retry() {
      if (Challenge.$is('Disposed')(challenge)) return
      challengeGeneration += 1
      challenge = Challenge.Waiting()
      status('verifying')
      const api = input.widget()

      if (widget !== undefined && api) api.reset(widget)
      else if (api) render()
      else load()
    },
    async submit() {
      if (!Challenge.$is('Ready')(challenge) || !challenge.token || submitting) return
      submitting = true
      status('submitting')
      const token = challenge.token
      const generation = challengeGeneration

      try {
        const request = input.prepare(token, controller.signal)
        challenge = Challenge.Waiting()
        const response = await request()

        if (Challenge.$is('Disposed')(challenge)) return

        if (response.ok && response.redirected) {
          input.redirect(response.url)

          return
        }

        if (generation === challengeGeneration) fail()
      } catch {
        if (generation === challengeGeneration) fail()
      } finally {
        submitting = false
      }
    },
    dispose() {
      challenge = Challenge.Disposed()
      controller.abort()
      unloadScript?.()

      if (widget !== undefined) input.widget()?.remove(widget)
    },
  }
}
