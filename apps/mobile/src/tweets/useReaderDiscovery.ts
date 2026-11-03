import { Effect, Exit } from 'effect'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { AppState } from 'react-native'

import { loadReaderNavigation } from '@/api/tweetReader'

import { readerConnection } from './useTweetReader'

export function useReaderDiscovery(sessionToken: string | null, slug: string | null) {
  const [result, setResult] = useState<{
    readonly slug: string
    readonly newerUnread: boolean
  } | null>(null)

  useFocusEffect(
    useCallback(() => {
      let pending: AbortController | null = null

      const refresh = () => {
        pending?.abort()

        if (!slug) return
        const controller = new AbortController()
        pending = controller

        const work = readerConnection(sessionToken).pipe(
          Effect.flatMap((connection) => loadReaderNavigation(connection, slug)),
          Effect.timeout('15 seconds'),
        )

        void Effect.runPromiseExit(work, { signal: controller.signal }).then((exit) => {
          if (controller.signal.aborted) return
          setResult({ slug, newerUnread: Exit.isSuccess(exit) && Boolean(exit.value.newerUnread) })
        })
      }

      refresh()

      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh()
      })

      return () => {
        pending?.abort()
        listener.remove()
      }
    }, [sessionToken, slug]),
  )

  return result?.slug === slug && result.newerUnread
}
