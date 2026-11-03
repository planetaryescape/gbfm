import { Effect, Redacted } from 'effect'
import { randomUUID } from 'expo-crypto'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { getHttpClient } from '@/api/client'
import {
  loadTweetForEdit,
  publishReply,
  saveTweet,
  TweetAuthoringFailed,
} from '@/api/tweetAuthoring'
import { env } from '@/env'
import { haptics } from '@/feedback/haptics'

import { emptyTweetDraft, musicCandidate, type TweetDraft, withText } from './draft'
import { readTweetDraft, removeTweetDraft, restoreTweetDraft, saveTweetDraft } from './draftStorage'
import { useMusicLookup } from './useMusicLookup'

const connection = (sessionToken: string | null) =>
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

export function useTweetComposer({
  identity,
  sessionToken,
  resolvesMusic,
  editSlug,
  replyTo,
  knownTags,
}: {
  readonly identity: string
  readonly sessionToken: string | null
  readonly resolvesMusic: boolean
  readonly editSlug: string | null
  readonly replyTo: string | null
  readonly knownTags: ReadonlyArray<string>
}) {
  const storageKey = editSlug
    ? `${identity}/edit/${editSlug}`
    : replyTo
      ? `${identity}/reply/${replyTo}`
      : identity

  const [draft, setDraft] = useState<TweetDraft | null>(null)
  const latest = useRef<TweetDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const controller = useRef<AbortController | null>(null)

  const accept = (restored: TweetDraft) => {
    latest.current = restored
    setDraft(restored)
    setError(null)
  }

  const loadRemote = (slug: string) => {
    const abort = new AbortController()
    controller.current = abort

    const work = Effect.suspend(() => connection(sessionToken)).pipe(
      Effect.flatMap((connected) => loadTweetForEdit(connected, slug)),
      Effect.timeout('20 seconds'),
      Effect.match({
        onSuccess: ({ draft: loaded }) => accept(loaded),
        onFailure: (cause) =>
          setError(
            cause instanceof TweetAuthoringFailed ? cause.message : 'Could not load this tweet.',
          ),
      }),
    )

    void Effect.runPromiseExit(work, { signal: abort.signal })
  }

  const load = () =>
    Effect.runSync(
      (editSlug || replyTo ? readTweetDraft(storageKey) : restoreTweetDraft(identity)).pipe(
        Effect.match({
          onSuccess: (stored) => {
            if (stored) accept(stored)
            else if (editSlug) loadRemote(editSlug)
            else accept(emptyTweetDraft(randomUUID()))
          },
          onFailure: (cause) => setError(cause.message),
        }),
      ),
    )

  const restore = useEffectEvent(load)

  useEffect(() => {
    restore()

    return () => controller.current?.abort()
  }, [])

  const change = (next: TweetDraft) => {
    latest.current = next
    setDraft(next)
    setNotice(null)

    return Effect.runSync(
      saveTweetDraft(storageKey, next).pipe(
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
      removeTweetDraft(storageKey).pipe(
        Effect.match({
          onSuccess: onDone,
          onFailure: (cause) => setError(cause.message),
        }),
      ),
    )
  }

  const save = (publish: boolean, onPublished: (slug: string) => void) => {
    if (!draft || locked.current || !change(draft)) return
    locked.current = true
    setBusy(true)
    const abort = new AbortController()
    controller.current = abort

    const work = connection(sessionToken).pipe(
      Effect.flatMap((connected) =>
        replyTo
          ? publishReply(connected, replyTo, draft)
          : saveTweet(connected, draft, publish, knownTags),
      ),
      Effect.timeoutOrElse({
        duration: '30 seconds',
        orElse: () =>
          Effect.fail(
            new TweetAuthoringFailed({
              message: replyTo
                ? 'The request timed out. Check the thread before retrying, so you do not reply twice.'
                : 'The request timed out. Retry to check and save the same tweet, without creating a second one.',
            }),
          ),
      }),
      Effect.tap((saved) =>
        Effect.sync(() => {
          if (publish) {
            Effect.runSync(
              removeTweetDraft(storageKey).pipe(
                Effect.match({
                  onSuccess: () => onPublished(saved.slug),
                  onFailure: () => {
                    latest.current = { ...draft, remote: true }
                    setDraft(latest.current)
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
        Effect.sync(() => {
          void haptics.failure()
          setError(
            cause instanceof TweetAuthoringFailed
              ? cause.message
              : 'Could not connect. Your local draft is safe.',
          )
        }),
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

  const candidate = draft && resolvesMusic && sessionToken ? musicCandidate(draft) : null

  const musicLoading = useMusicLookup(candidate, sessionToken, (music) => {
    const current = latest.current

    if (current && musicCandidate(current) === candidate) change({ ...current, music })
  })

  const setText = (text: string) => {
    if (latest.current) change(withText(latest.current, text))
  }

  const dismissMusic = () => {
    const current = latest.current

    if (current?.music)
      change({ ...current, music: null, dismissedMusicUrl: current.music.url ?? null })
  }

  return {
    draft,
    error,
    notice,
    busy,
    musicLoading,
    change,
    setText,
    dismissMusic,
    discard,
    save,
    retry: load,
    editing: editSlug !== null,
    replying: replyTo !== null,
  }
}
