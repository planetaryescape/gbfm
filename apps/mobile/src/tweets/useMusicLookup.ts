import { Effect, Redacted } from 'effect'
import { useEffect, useEffectEvent, useState } from 'react'

import { getHttpClient } from '@/api/client'
import { resolveTweetMusic } from '@/api/tweetAuthoring'
import { env } from '@/env'

import type { MusicAttachment } from './draft'

export function useMusicLookup(
  link: string | null,
  sessionToken: string | null,
  onResolved: (music: MusicAttachment) => void,
) {
  const [loading, setLoading] = useState(false)
  const resolved = useEffectEvent(onResolved)

  useEffect(() => {
    if (!link || !sessionToken) return undefined
    const abort = new AbortController()

    const work = Effect.sleep('700 millis').pipe(
      Effect.tap(() => Effect.sync(() => setLoading(true))),
      Effect.andThen(getHttpClient),
      Effect.flatMap((httpClient) =>
        resolveTweetMusic(
          {
            httpClient,
            baseUrl: env.EXPO_PUBLIC_API_URL,
            sessionToken: Redacted.make(sessionToken),
          },
          link,
        ),
      ),
      Effect.timeout('20 seconds'),
      Effect.tap((music) => Effect.sync(() => resolved(music))),
      Effect.ensuring(Effect.sync(() => setLoading(false))),
    )

    void Effect.runPromiseExit(work, { signal: abort.signal })

    return () => abort.abort()
  }, [link, sessionToken])

  return loading
}
