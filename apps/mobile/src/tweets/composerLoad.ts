import { Effect } from 'effect'

export type ComposerLoadAttempt = {
  readonly signal: AbortSignal
  readonly commit: (update: () => void) => void
  readonly run: <A, E, R>(
    request: Effect.Effect<A, E, R>,
    onSuccess: (value: A) => void,
    onFailure: (error: E) => void,
  ) => Effect.Effect<void, never, R>
}

export const createComposerLoadOwner = () => {
  let current: AbortController | null = null

  const cancel = () => {
    const previous = current
    current = null
    previous?.abort()
  }

  const start = (): ComposerLoadAttempt => {
    cancel()
    const controller = new AbortController()
    current = controller

    const commit = (update: () => void) => {
      if (current === controller && !controller.signal.aborted) update()
    }

    return {
      signal: controller.signal,
      commit,
      run: Effect.fn('ComposerLoadAttempt.run')(
        <A, E, R>(
          request: Effect.Effect<A, E, R>,
          onSuccess: (value: A) => void,
          onFailure: (error: E) => void,
        ) =>
          request.pipe(
            Effect.match({
              onSuccess: (value) => commit(() => onSuccess(value)),
              onFailure: (error) => commit(() => onFailure(error)),
            }),
          ),
      ),
    }
  }

  return { start, cancel }
}
