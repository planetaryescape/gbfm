import { Effect } from 'effect'
import { useEffect, useState } from 'react'

import { getTweetTags } from '@/api/tweets'

export function useKnownTags() {
  const [fetched, setFetched] = useState<ReadonlyArray<string>>([])

  useEffect(() => {
    const abort = new AbortController()

    void Effect.runPromiseExit(
      getTweetTags.pipe(
        Effect.timeout('10 seconds'),
        Effect.tap((tags) => Effect.sync(() => setFetched(tags))),
      ),
      { signal: abort.signal },
    )

    return () => abort.abort()
  }, [])

  return fetched
}
