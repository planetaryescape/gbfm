import { Cause, Data, Effect, Result } from 'effect'

import { TweetAuthoringFailed } from '@/api/tweetAuthoring'

import type { TweetDraft } from './draft'
import { TweetDraftStorage } from './draftRestore'

export type ComposerSubmission = Data.TaggedEnum<{
  RemoteDraftSaved: { readonly draft: TweetDraft; readonly localSaved: boolean }
  Published: { readonly slug: string }
  PublishedNotCleared: { readonly draft: TweetDraft; readonly slug: string }
  ReplyOutcomeUncertain: { readonly message: string }
  RequestFailed: { readonly message: string }
}>

export const ComposerSubmission = Data.taggedEnum<ComposerSubmission>()

export const submitComposerDraft = Effect.fn('submitComposerDraft')(function* <E, R>(
  storageKey: string,
  draft: TweetDraft,
  publish: boolean,
  replying: boolean,
  request: Effect.Effect<{ readonly slug: string }, E, R>,
  publishedSlug: string | null = null,
) {
  const storage = yield* TweetDraftStorage

  const response = yield* (publishedSlug ? Effect.succeed({ slug: publishedSlug }) : request).pipe(
    Effect.timeout('30 seconds'),
    Effect.result,
  )

  if (Result.isFailure(response)) {
    if (Cause.isTimeoutError(response.failure))
      return replying
        ? ComposerSubmission.ReplyOutcomeUncertain({
            message:
              'The reply may have been published. Your local draft is safe. Check the thread before trying again, so you do not reply twice.',
          })
        : ComposerSubmission.RequestFailed({
            message:
              'The request timed out. Retry to check and save the same tweet, without creating a second one.',
          })

    return ComposerSubmission.RequestFailed({
      message:
        response.failure instanceof TweetAuthoringFailed
          ? response.failure.message
          : 'Could not connect. Your local draft is safe.',
    })
  }

  const remote = { ...draft, remote: true }

  if (publish) {
    const cleared = yield* storage.remove(storageKey).pipe(Effect.isSuccess)

    return cleared
      ? ComposerSubmission.Published({ slug: response.success.slug })
      : ComposerSubmission.PublishedNotCleared({ draft: remote, slug: response.success.slug })
  }

  const localSaved = yield* storage.save(storageKey, remote).pipe(Effect.isSuccess)

  return ComposerSubmission.RemoteDraftSaved({ draft: remote, localSaved })
})
