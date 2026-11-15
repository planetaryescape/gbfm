import { Effect, Exit } from 'effect'
import { useEffect, useState } from 'react'

import { type loadEditorial, readEditorial } from '@/api/editorialReader'

type Editorial = Effect.Success<ReturnType<typeof loadEditorial>>

export type EditorialState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly post: Editorial }

export const useEditorial = (
  slug: string,
  read: typeof readEditorial = readEditorial,
): EditorialState => {
  const [state, setState] = useState<{ readonly slug: string; readonly value: EditorialState }>({
    slug,
    value: { status: 'loading' },
  })

  if (state.slug !== slug) setState({ slug, value: { status: 'loading' } })

  useEffect(() => {
    const controller = new AbortController()

    void Effect.runPromiseExit(
      read(slug).pipe(
        Effect.map((post): EditorialState => ({ status: 'ready', post })),
        Effect.catchTag('EditorialMissing', () =>
          Effect.succeed<EditorialState>({ status: 'missing' }),
        ),
        Effect.orElseSucceed((): EditorialState => ({ status: 'unavailable' })),
      ),
      { signal: controller.signal },
    ).then((exit) => {
      if (!controller.signal.aborted)
        setState({
          slug,
          value: Exit.isSuccess(exit) ? exit.value : { status: 'unavailable' },
        })
    })

    return () => controller.abort()
  }, [slug, read])

  return state.slug === slug ? state.value : { status: 'loading' }
}
