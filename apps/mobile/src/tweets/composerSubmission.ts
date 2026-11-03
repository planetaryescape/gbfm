import { Data, Effect, Result } from 'effect'

import { TweetAuthoringFailed } from '@/api/tweetAuthoring'

import type { TweetDraft } from './draft'
import { TweetDraftStorage } from './draftRestore'

export type ComposerSubmission = Data.TaggedEnum<{
  RemoteDraftSaved: { readonly draft: TweetDraft; readonly localSaved: boolean }
  Published: { readonly slug: string }
  PublishedNotCleared: { readonly draft: TweetDraft }
  RequestFailed: { readonly message: string }
}>

export const ComposerSubmission = Data.taggedEnum<ComposerSubmission>()

export const submitComposerDraft = Effect.fn('submitComposerDraft')(function* <E, R>(
  storageKey: string,
  draft: TweetDraft,
  publish: boolean,
  replying: boolean,
  request: Effect.Effect<{ readonly slug: string }, E, R>,
) {
  const storage = yield* TweetDraftStorage

  const response = yield* request.pipe(
    Effect.timeoutOrElse({
      duration: '30 seconds',
      orElse: () =>
        Effect.fail(
          new TweetAuthoringFailed({
            message: replying
              ? 'The request timed out. Check the thread before retrying, so you do not reply twice.'
              : 'The request timed out. Retry to check and save the same tweet, without creating a second one.',
          }),
        ),
    }),
    Effect.result,
  )

  if (Result.isFailure(response))
    return ComposerSubmission.RequestFailed({
      message:
        response.failure instanceof TweetAuthoringFailed
          ? response.failure.message
          : 'Could not connect. Your local draft is safe.',
    })

  const remote = { ...draft, remote: true }

  if (publish) {
    const cleared = yield* storage.remove(storageKey).pipe(Effect.isSuccess)

    return cleared
      ? ComposerSubmission.Published({ slug: response.success.slug })
      : ComposerSubmission.PublishedNotCleared({ draft: remote })
  }

  const localSaved = yield* storage.save(storageKey, remote).pipe(Effect.isSuccess)

  return ComposerSubmission.RemoteDraftSaved({ draft: remote, localSaved })
})
