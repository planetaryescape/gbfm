import { Effect, Redacted } from 'effect'
import { randomUUID } from 'expo-crypto'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getHttpClient } from '@/api/client'
import { resolveTweetMusic, saveTweet, TweetAuthoringFailed } from '@/api/tweetAuthoring'
import { env } from '@/env'

import { emptyTweetDraft, type TweetDraft } from './draft'
import { removeTweetDraft, restoreTweetDraft, saveTweetDraft } from './draftStorage'

export function useTweetComposer(identity: string, sessionToken: string | null) {
  const [draft, setDraft] = useState<TweetDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const controller = useRef<AbortController | null>(null)

  const restore = useCallback(
    () =>
      Effect.runSync(
        restoreTweetDraft(identity).pipe(
          Effect.match({
            onSuccess: (stored) => {
              setDraft(stored ?? emptyTweetDraft(randomUUID()))
              setError(null)
            },
            onFailure: (cause) => setError(cause.message),
          }),
        ),
      ),
    [identity],
  )

  useEffect(() => {
    restore()

    return () => controller.current?.abort()
  }, [restore])

  const change = (next: TweetDraft) => {
    setDraft(next)
    setNotice(null)

    return Effect.runSync(
      saveTweetDraft(identity, next).pipe(
        Effect.match({
          onSuccess: () => {
            setError(null)

            return true
          },
          onFailure: () => {
            setError(
              'Could not save your draft on this device. Keep this screen open and try again.',
            )

            return false
          },
        }),
      ),
    )
  }

  const discard = (onDone: () => void) => {
    if (locked.current) return
    Effect.runSync(
      removeTweetDraft(identity).pipe(
        Effect.match({
          onSuccess: onDone,
          onFailure: (cause) => setError(cause.message),
        }),
      ),
    )
  }

  const connection = () =>
    Effect.gen(function* () {
      if (!sessionToken)
        return yield* new TweetAuthoringFailed({
          message: 'Sign in to save or publish your tweet.',
        })
      const httpClient = yield* getHttpClient

      return {
        httpClient,
        baseUrl: env.EXPO_PUBLIC_API_URL,
        sessionToken: Redacted.make(sessionToken),
      }
    })

  const save = (publish: boolean, onPublished: (slug: string) => void) => {
    if (!draft || locked.current || !change(draft)) return
    locked.current = true
    setBusy(true)
    const abort = new AbortController()
    controller.current = abort

    const work = connection().pipe(
      Effect.flatMap((connected) => saveTweet(connected, draft, publish)),
      Effect.timeoutOrElse({
        duration: '30 seconds',
        orElse: () =>
          Effect.fail(
            new TweetAuthoringFailed({
              message:
                'The request timed out. Retry to check and save the same tweet, without creating a second one.',
            }),
          ),
      }),
      Effect.tap((saved) =>
        Effect.sync(() => {
          if (publish) {
            Effect.runSync(
              removeTweetDraft(identity).pipe(
                Effect.match({
                  onSuccess: () => onPublished(saved.slug),
                  onFailure: () => {
                    setDraft({ ...draft, remote: true })
                    setError(
                      'Your tweet was published, but the local draft could not be cleared. Close this screen and check your tweet before trying again.',
                    )
                  },
                }),
              ),
            )
          } else {
            change({ ...draft, remote: true })
            setNotice('Draft saved to your account. It is not public.')
          }
        }),
      ),
      Effect.catch((cause) =>
        Effect.sync(() =>
          setError(
            cause instanceof TweetAuthoringFailed
              ? cause.message
              : 'Could not connect. Your local draft is safe.',
          ),
        ),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          locked.current = false
          setBusy(false)
        }),
      ),
    )

    void Effect.runPromiseExit(work, { signal: abort.signal })
  }

  const attachMusic = (url: string) => {
    if (!draft || locked.current || !url.trim()) return
    locked.current = true
    setBusy(true)
    const abort = new AbortController()
    controller.current = abort

    const work = connection().pipe(
      Effect.flatMap((connected) => resolveTweetMusic(connected, url)),
      Effect.timeoutOrElse({
        duration: '30 seconds',
        orElse: () =>
          Effect.fail(new TweetAuthoringFailed({ message: 'Music lookup timed out. Try again.' })),
      }),
      Effect.match({
        onSuccess: (music) => change({ ...draft, music }),
        onFailure: (cause) =>
          setError(
            cause instanceof TweetAuthoringFailed
              ? cause.message
              : 'Could not connect to music providers.',
          ),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          locked.current = false
          setBusy(false)
        }),
      ),
    )

    void Effect.runPromiseExit(work, { signal: abort.signal })
  }

  return { draft, error, notice, busy, change, discard, save, attachMusic, restore }
}
