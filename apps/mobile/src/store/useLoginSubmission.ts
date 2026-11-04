import { Effect } from 'effect'
import { useEffect, useRef, useState } from 'react'

import type { AuthSession } from './authLifecycle'
import { idleLoginSubmission, type LoginSubmission, submitLogin } from './loginSubmission'

export function useLoginSubmission() {
  const [submission, setSubmission] = useState<LoginSubmission>(idleLoginSubmission)
  const owner = useRef({ mounted: false, submitting: false, controller: new AbortController() })

  useEffect(() => {
    const lifetime = owner.current
    lifetime.mounted = true

    return () => {
      lifetime.mounted = false
      lifetime.submitting = false
      lifetime.controller.abort()
    }
  }, [])

  const submit = <E>(request: Effect.Effect<AuthSession, E>, onSignedIn: () => void) => {
    if (!owner.current.mounted || owner.current.submitting) return null
    const controller = new AbortController()
    owner.current.controller = controller
    owner.current.submitting = true

    const owns = () =>
      owner.current.mounted && owner.current.controller === controller && !controller.signal.aborted

    return Effect.runPromiseExit(
      submitLogin(
        request,
        (update) => {
          if (owns()) setSubmission((current) => (owns() ? update(current) : current))
        },
        () => {
          if (owns()) onSignedIn()
        },
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (owner.current.controller === controller) owner.current.submitting = false
          }),
        ),
      ),
      { signal: controller.signal },
    )
  }

  return { submission, submit }
}
