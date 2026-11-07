import { Effect, Predicate, Redacted } from 'effect'
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

import { createComposerLoadOwner, type ComposerLoadAttempt } from './composerLoad'
import { ComposerReceiptStorage } from './composerReceipts'
import { ComposerSubmission } from './composerSubmission'
import { emptyTweetDraft, musicCandidate, type TweetDraft, withText } from './draft'
import { TweetDraftStorage } from './draftRestore'
import {
  composerReceiptStorage,
  readTweetDraft,
  removeTweetDraft,
  restoreTweetDraft,
  saveTweetDraft,
} from './draftStorage'
import { useComposerSession } from './useComposerSession'
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

  const [snapshot, setSnapshot] = useState<{
    readonly storageKey: string
    readonly draft: TweetDraft
  } | null>(null)

  const draft = snapshot?.storageKey === storageKey ? snapshot.draft : null
  const setDraft = (value: TweetDraft) => setSnapshot({ storageKey, draft: value })
  const latest = useRef<{ readonly storageKey: string; readonly draft: TweetDraft } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const session = useComposerSession(identity, storageKey)
  const { owner, publication } = session
  const [loads] = useState(createComposerLoadOwner)
  const editable = Predicate.isTagged(publication, 'Writable')
  const cleanupPending = Predicate.isTagged(publication, 'CleanupPending')

  const accept = (restored: TweetDraft) => {
    owner.change(storageKey, () => {
      latest.current = { storageKey, draft: restored }
      setDraft(restored)
      setError(null)

      return true
    })
  }

  const loadRemote = (slug: string, attempt: ComposerLoadAttempt) => {
    const request = Effect.suspend(() => connection(sessionToken)).pipe(
      Effect.flatMap((connected) => loadTweetForEdit(connected, slug)),
      Effect.timeout('20 seconds'),
    )

    const work = attempt.run(
      request,
      ({ draft: loaded }) => accept(loaded),
      (cause) =>
        setError(
          cause instanceof TweetAuthoringFailed ? cause.message : 'Could not load this tweet.',
        ),
    )

    void Effect.runPromiseExit(work, { signal: attempt.signal })
  }

  const load = () => {
    if (!session.available()) return
    const attempt = loads.start()

    return Effect.runSync(
      owner.restore(storageKey).pipe(
        Effect.provideService(ComposerReceiptStorage, composerReceiptStorage),
        Effect.flatMap((restoredPublication) => {
          if (
            Predicate.isTagged(restoredPublication, 'CleanupPending') ||
            Predicate.isTagged(restoredPublication, 'PublicationUncertain')
          ) {
            attempt.commit(() => {
              latest.current = { storageKey, draft: restoredPublication.draft }
              setDraft(restoredPublication.draft)
              setError(
                Predicate.isTagged(restoredPublication, 'PublicationUncertain')
                  ? restoredPublication.message
                  : 'Already published. Retry local cleanup without publishing again.',
              )
            })

            return Effect.succeed(null)
          }

          return editSlug || replyTo ? readTweetDraft(storageKey) : restoreTweetDraft(identity)
        }),
        Effect.match({
          onSuccess: (stored) => {
            attempt.commit(() => {
              if (!Predicate.isTagged(owner.state(storageKey), 'Writable')) return

              if (stored) accept(stored)
              else if (editSlug) loadRemote(editSlug, attempt)
              else accept(emptyTweetDraft(randomUUID()))
            })
          },
          onFailure: (cause) => attempt.commit(() => setError(cause.message)),
        }),
      ),
    )
  }

  const restore = useEffectEvent((principal: string, key: string) => {
    if (identity === principal && storageKey === key) load()
  })

  useEffect(() => {
    restore(identity, storageKey)

    return () => {
      loads.cancel()
    }
  }, [loads, identity, storageKey])

  const change = (next: TweetDraft) => {
    if (!session.available()) return false

    return owner.change(storageKey, () => {
      latest.current = { storageKey, draft: next }
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
    })
  }

  const discard = (onDone: () => void) => {
    if (!session.available() || !Predicate.isTagged(owner.state(storageKey), 'Writable')) return
    Effect.runSync(
      removeTweetDraft(storageKey).pipe(
        Effect.match({
          onSuccess: onDone,
          onFailure: (cause) => setError(cause.message),
        }),
      ),
    )
  }

  const recover = () => {
    if (!session.available()) return
    Effect.runSync(
      owner.recover(storageKey).pipe(
        Effect.provideService(ComposerReceiptStorage, composerReceiptStorage),
        Effect.provideService(TweetDraftStorage, {
          read: readTweetDraft,
          save: saveTweetDraft,
          remove: removeTweetDraft,
        }),
        Effect.match({
          onFailure: ({ message }) => setError(message),
          onSuccess: (cleared) => {
            if (cleared) {
              load()
              setNotice(
                'Recovery record cleared. Your draft was kept. Nothing was sent. Check publication before choosing to send again.',
              )
            }
          },
        }),
      ),
    )
  }

  const save = (publish: boolean, onPublished: (slug: string) => void) => {
    if (!draft || !session.available()) return

    if (!publish && !editable) return

    if (!cleanupPending && !change(draft)) return
    loads.cancel()

    const request = connection(sessionToken).pipe(
      Effect.flatMap((connected) =>
        replyTo
          ? publishReply(connected, replyTo, draft)
          : saveTweet(connected, draft, publish, knownTags),
      ),
    )

    const work = owner.submit(storageKey, draft, publish, Boolean(replyTo), request).pipe(
      Effect.provideService(TweetDraftStorage, {
        read: readTweetDraft,
        save: saveTweetDraft,
        remove: removeTweetDraft,
      }),
      Effect.provideService(ComposerReceiptStorage, composerReceiptStorage),
    )

    void session.run(work, (outcome) => {
      if (!outcome) return
      ComposerSubmission.$match(outcome, {
        Published: ({ slug }) => onPublished(slug),
        PublishedNotCleared: ({ draft: remote }) => {
          latest.current = { storageKey, draft: remote }
          setDraft(remote)
          setError(
            'Published, but local recovery or cleanup could not finish. Retry cleanup without publishing again. If you close now, this device may ask you to check publication.',
          )
        },
        RemoteDraftSaved: ({ draft: remote, localSaved }) => {
          latest.current = { storageKey, draft: remote }
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
        PublicationOutcomeUncertain: ({ message }) => {
          void haptics.failure()
          setError(message)
        },
      })
    })
  }

  const candidate =
    editable && draft && resolvesMusic && sessionToken ? musicCandidate(draft) : null

  const musicLoading = useMusicLookup(candidate, sessionToken, (music) => {
    const current = latest.current?.storageKey === storageKey ? latest.current.draft : null

    if (current && musicCandidate(current) === candidate) change({ ...current, music })
  })

  const setText = (text: string) => {
    if (latest.current?.storageKey === storageKey) change(withText(latest.current.draft, text))
  }

  const dismissMusic = () => {
    const current = latest.current?.storageKey === storageKey ? latest.current.draft : null

    if (current?.music)
      change({ ...current, music: null, dismissedMusicUrl: current.music.url ?? null })
  }

  return {
    draft,
    error,
    notice,
    busy: session.busy,
    publication,
    musicLoading,
    change,
    setText,
    dismissMusic,
    discard,
    recover,
    save,
    retry: load,
    editing: editSlug !== null,
    replying: replyTo !== null,
  }
}
