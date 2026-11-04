import { Effect, Redacted } from 'effect'
import { useEffect, useEffectEvent, useState } from 'react'

import { getHttpClient } from '@/api/client'
import { resolveTweetMusic } from '@/api/tweetAuthoring'
import { env } from '@/env'

import type { MusicAttachment } from './draft'
import { lookupMusic } from './musicLookup'

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

    const request = getHttpClient.pipe(
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
    )

    const work = lookupMusic(request, setLoading, resolved)

    void Effect.runPromiseExit(work, { signal: abort.signal })

    return () => abort.abort()
  }, [link, sessionToken])

  return loading
}
