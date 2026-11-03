import { Data, Effect, Redacted } from 'effect'
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

import { ComposerSubmission, submitComposerDraft } from './composerSubmission'
import { emptyTweetDraft, musicCandidate, type TweetDraft, withText } from './draft'
import { TweetDraftStorage } from './draftRestore'
import { readTweetDraft, removeTweetDraft, restoreTweetDraft, saveTweetDraft } from './draftStorage'
import { useMusicLookup } from './useMusicLookup'

type SubmissionState = { readonly _tag: 'Idle' } | { readonly _tag: 'Submitting' }

const SubmissionState = Data.taggedEnum<SubmissionState>()

const idleSubmission = SubmissionState.Idle()

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
  const [submission, setSubmission] = useState<SubmissionState>(idleSubmission)
  const submissionRef = useRef(submission)
  const controller = useRef<AbortController | null>(null)
  const published = useRef<{ readonly storageKey: string; readonly slug: string } | null>(null)

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
    if (SubmissionState.$is('Submitting')(submissionRef.current)) return
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
    if (!draft || SubmissionState.$is('Submitting')(submissionRef.current) || !change(draft)) return
    submissionRef.current = SubmissionState.Submitting()
    setSubmission(submissionRef.current)
    const abort = new AbortController()
    controller.current = abort

    const request = connection(sessionToken).pipe(
      Effect.flatMap((connected) =>
        replyTo
          ? publishReply(connected, replyTo, draft)
          : saveTweet(connected, draft, publish, knownTags),
      ),
    )

    const publishedSlug =
      published.current?.storageKey === storageKey ? published.current.slug : null

    const work = submitComposerDraft(
      storageKey,
      draft,
      publish,
      Boolean(replyTo),
      request,
      publishedSlug,
    ).pipe(
      Effect.provideService(TweetDraftStorage, {
        read: readTweetDraft,
        save: saveTweetDraft,
        remove: removeTweetDraft,
      }),
      Effect.tap((outcome) =>
        Effect.sync(() =>
          ComposerSubmission.$match(outcome, {
            Published: ({ slug }) => onPublished(slug),
            PublishedNotCleared: ({ draft: remote, slug }) => {
              published.current = { storageKey, slug }
              latest.current = remote
              setDraft(remote)
              setError(
                'Published, but the local draft could not be cleared. Try again to clear it without publishing again.',
              )
            },
            RemoteDraftSaved: ({ draft: remote, localSaved }) => {
              latest.current = remote
              setDraft(remote)
              setNotice('Draft saved to your account. It is not public.')
              setError(
                localSaved
                  ? null
                  : 'Could not save your draft on this device. Keep this screen open and try again.',
              )
            },
            RequestFailed: ({ message }) => {
              void haptics.failure()
              setError(message)
            },
          }),
        ),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          submissionRef.current = SubmissionState.Idle()
          setSubmission(submissionRef.current)
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
    busy: SubmissionState.$is('Submitting')(submission),
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
