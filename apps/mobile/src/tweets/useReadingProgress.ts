import { useAtomSet } from '@effect/atom-react'
import { Effect } from 'effect'
import { useEffect, useRef } from 'react'

import { recordReaderVisit } from '@/api/tweetReader'

import { saveReaderPosition } from './readerPosition'
import { checkpoints, readerConnection } from './useTweetReader'

export function useReadingProgress(identity: string, sessionToken: string | null) {
  const remember = useAtomSet(checkpoints)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  return (slug: string) => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    remember((positions) => ({ ...positions, [identity]: slug }))
    saveReaderPosition(identity, slug)

    const work = readerConnection(sessionToken).pipe(
      Effect.flatMap((connection) => recordReaderVisit(connection, slug)),
      Effect.timeout('15 seconds'),
      Effect.ignore,
    )

    void Effect.runPromiseExit(work, { signal: abort.signal })
  }
}
