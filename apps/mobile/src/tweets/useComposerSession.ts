import { Effect } from 'effect'
import { useEffect, useMemo, useState } from 'react'

import { createComposerOwner } from './composerOwner'

const createLifetime = (principal: string, storageKey: string) => {
  let active = false
  let controller: AbortController | null = null

  return {
    owner: createComposerOwner(principal),
    storageKey,
    mount: () => {
      active = true

      return () => {
        active = false
        controller?.abort()
      }
    },
    start: () => {
      if (!active || controller) return null
      controller = new AbortController()

      return controller
    },
    owns: (abort: AbortController) => active && controller === abort && !abort.signal.aborted,
    finish: (abort: AbortController) => {
      if (controller === abort) controller = null
    },
    available: () => active && controller === null,
  }
}

export function useComposerSession(principal: string, storageKey: string) {
  const lifetime = useMemo(() => createLifetime(principal, storageKey), [principal, storageKey])
  const [busyLifetime, setBusyLifetime] = useState<typeof lifetime | null>(null)

  useEffect(() => lifetime.mount(), [lifetime])

  const run = <A, E>(work: Effect.Effect<A, E>, accept: (value: A) => void) => {
    const abort = lifetime.start()

    if (!abort) return null
    setBusyLifetime(lifetime)

    return Effect.runPromiseExit(
      work.pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            if (lifetime.owns(abort)) accept(value)
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (lifetime.owns(abort)) setBusyLifetime(null)
            lifetime.finish(abort)
          }),
        ),
      ),
      { signal: abort.signal },
    )
  }

  return {
    owner: lifetime.owner,
    busy: busyLifetime === lifetime,
    run,
    available: lifetime.available,
    publication: lifetime.owner.state(lifetime.storageKey),
  }
}
