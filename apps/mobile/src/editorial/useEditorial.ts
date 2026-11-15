import { Effect } from 'effect'
import { useEffect, useState } from 'react'

import { loadEditorial } from '@/api/editorialReader'
import { readerConnection } from '@/tweets/useTweetReader'

type Editorial = Effect.Success<ReturnType<typeof loadEditorial>>

export type EditorialState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly post: Editorial }

export const useEditorial = (slug: string): EditorialState => {
  const [state, setState] = useState<EditorialState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    void Effect.runPromise(
      readerConnection(null).pipe(
        Effect.flatMap((connection) => loadEditorial(connection, slug)),
        Effect.map((post): EditorialState => ({ status: 'ready', post })),
        Effect.catchTag('EditorialMissing', () =>
          Effect.succeed<EditorialState>({ status: 'missing' }),
        ),
        Effect.orElseSucceed((): EditorialState => ({ status: 'unavailable' })),
      ),
      { signal: controller.signal },
    ).then((next) => {
      if (!controller.signal.aborted) setState(next)
    })

    return () => controller.abort()
  }, [slug])

  return state
}
