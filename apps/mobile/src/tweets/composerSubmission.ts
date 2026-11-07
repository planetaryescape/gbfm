import { Data, Effect, Predicate, Result, Schema } from 'effect'

import { TweetAuthoringFailed } from '@/api/tweetAuthoring'

import {
  ComposerReceiptStorage,
  type ComposerScope,
  ConfirmedPublication,
  PendingPublication,
} from './composerReceipts'
import { TweetDraft } from './draft'
import { TweetDraftStorage } from './draftRestore'

export type ComposerSubmission = Data.TaggedEnum<{
  RemoteDraftSaved: { readonly draft: TweetDraft; readonly localSaved: boolean }
  Published: { readonly slug: string }
  PublishedNotCleared: { readonly draft: TweetDraft; readonly slug: string }
  PublicationOutcomeUncertain: { readonly message: string }
  RequestFailed: { readonly message: string }
}>

export const ComposerSubmission = Data.taggedEnum<ComposerSubmission>()

const sameDraft = Schema.toEquivalence(TweetDraft)

export const publicationUncertainty = (replying: boolean) =>
  replying
    ? 'The reply may have been published. Automatic resubmission is blocked on this device. Check the thread so you do not reply twice. Your local draft is preserved.'
    : 'The post may have been published. Automatic resubmission is blocked on this device. Check the post before taking further action. Your local draft is preserved.'

export const submitComposerDraft = Effect.fn('submitComposerDraft')(function* <E, R>(
  scope: ComposerScope,
  draft: TweetDraft,
  publish: boolean,
  replying: boolean,
  request: Effect.Effect<{ readonly slug: string }, E, R>,
  confirmed: ConfirmedPublication | null = null,
) {
  const storage = yield* TweetDraftStorage
  const { storageKey } = scope
  const receipts = yield* ComposerReceiptStorage
  const restored = yield* receipts.read(scope).pipe(Effect.result)

  if (Result.isFailure(restored))
    return ComposerSubmission.RequestFailed({ message: restored.failure.message })

  if (!publish && restored.success) {
    return Predicate.isTagged(restored.success, 'Confirmed')
      ? ComposerSubmission.PublishedNotCleared({
          draft: { ...restored.success.draft, remote: true },
          slug: restored.success.slug,
        })
      : ComposerSubmission.PublicationOutcomeUncertain({
          message: publicationUncertainty(restored.success.replying),
        })
  }

  if (publish) {
    let receipt = Predicate.isTagged(restored.success, 'Confirmed')
      ? restored.success
      : (confirmed ?? restored.success)

    if (Predicate.isTagged(receipt, 'Pending'))
      return ComposerSubmission.PublicationOutcomeUncertain({
        message: publicationUncertainty(replying),
      })

    if (!receipt) {
      const pending = PendingPublication.make({ ...scope, version: 1, draft, replying })
      const persisted = yield* receipts.write(pending).pipe(Effect.result)

      if (Result.isFailure(persisted))
        return ComposerSubmission.RequestFailed({
          message:
            'Could not save publication intent on this device. Nothing was sent. Try again when storage is available.',
        })

      const response = yield* request.pipe(Effect.timeout('30 seconds'), Effect.result)

      if (Result.isFailure(response)) {
        if (response.failure instanceof TweetAuthoringFailed) {
          const cleared = yield* receipts.remove(scope).pipe(Effect.isSuccess)

          return cleared
            ? ComposerSubmission.RequestFailed({ message: response.failure.message })
            : ComposerSubmission.PublicationOutcomeUncertain({
                message: `${response.failure.message} The request was rejected, but its local recovery record could not be cleared. Sending stays blocked until you clear that record through recovery options. Your draft is preserved.`,
              })
        }

        return ComposerSubmission.PublicationOutcomeUncertain({
          message: publicationUncertainty(replying),
        })
      }

      receipt = ConfirmedPublication.make({
        ...scope,
        version: 1,
        draft,
        replying,
        slug: response.success.slug,
      })
    }

    const publication = receipt
    const remote = { ...publication.draft, remote: true }

    const completed = yield* Effect.gen(function* () {
      yield* receipts.write(publication)
      const current = yield* storage.read(storageKey)

      if (current && sameDraft(current, publication.draft)) yield* storage.remove(storageKey)
      yield* receipts.remove(scope)
    }).pipe(Effect.isSuccess)

    return completed
      ? ComposerSubmission.Published({ slug: publication.slug })
      : ComposerSubmission.PublishedNotCleared({ draft: remote, slug: publication.slug })
  }

  const response = yield* request.pipe(Effect.timeout('30 seconds'), Effect.result)

  if (Result.isFailure(response)) {
    return ComposerSubmission.RequestFailed({
      message:
        response.failure instanceof TweetAuthoringFailed
          ? response.failure.message
          : 'Could not connect. Your local draft is safe.',
    })
  }

  const remote = { ...draft, remote: true }

  const localSaved = yield* storage.save(storageKey, remote).pipe(Effect.isSuccess)

  return ComposerSubmission.RemoteDraftSaved({ draft: remote, localSaved })
})
