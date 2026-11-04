import { Data, Effect, Predicate } from 'effect'

import {
  ComposerReceiptStorage,
  ConfirmedPublication,
  type ComposerReceipt,
} from './composerReceipts'
import {
  ComposerSubmission,
  publicationUncertainty,
  submitComposerDraft,
} from './composerSubmission'
import type { TweetDraft } from './draft'

export type ComposerPublication =
  | { readonly _tag: 'Writable' }
  | Data.TaggedEnum<{
      CleanupPending: {
        readonly draft: TweetDraft
        readonly slug: string
        readonly snapshot: TweetDraft
      }
      Published: { readonly slug: string }
      PublicationUncertain: {
        readonly draft: TweetDraft
        readonly message: string
        readonly replying: boolean
      }
      RecoveryBlocked: { readonly message: string }
    }>

export const ComposerPublication = Data.taggedEnum<ComposerPublication>()

const writable = ComposerPublication.Writable()

export const composerControls = (
  publication: ComposerPublication,
  fresh: { readonly canSubmit: boolean; readonly canSave: boolean; readonly label: string },
) => {
  const editable = ComposerPublication.$is('Writable')(publication)
  const cleanupPending = ComposerPublication.$is('CleanupPending')(publication)
  const requiresThreadCheck = ComposerPublication.$is('PublicationUncertain')(publication)

  return {
    editable,
    cleanupPending,
    requiresThreadCheck,
    canSubmit: cleanupPending || requiresThreadCheck || (editable && fresh.canSubmit),
    canSave: editable && fresh.canSave,
    label: ComposerPublication.$match(publication, {
      Writable: () => fresh.label,
      CleanupPending: () => 'Retry cleanup',
      Published: () => fresh.label,
      PublicationUncertain: ({ replying }) => (replying ? 'Check thread' : 'Check post'),
      RecoveryBlocked: () => 'Recovery unavailable',
    }),
    busyLabel: cleanupPending ? 'Clearing' : 'Saving',
  }
}

export const createComposerOwner = (principal: string) => {
  const current = new Map<string, ComposerPublication>()
  const submitting = new Set<string>()

  const state = (storageKey: string) => current.get(storageKey) ?? writable

  const remember = (receipt: ComposerReceipt) => {
    const publication = Predicate.isTagged(receipt, 'Confirmed')
      ? ComposerPublication.CleanupPending({
          draft: { ...receipt.draft, remote: true },
          snapshot: receipt.draft,
          slug: receipt.slug,
        })
      : ComposerPublication.PublicationUncertain({
          draft: receipt.draft,
          replying: receipt.replying,
          message: publicationUncertainty(receipt.replying),
        })

    current.set(receipt.storageKey, publication)

    return publication
  }

  const restore = (storageKey: string) =>
    Effect.gen(function* () {
      if (principal === 'guest') return state(storageKey)
      const receipts = yield* ComposerReceiptStorage

      const receipt = yield* receipts
        .read({ principal, storageKey })
        .pipe(
          Effect.tapError(({ message }) =>
            Effect.sync(() =>
              current.set(storageKey, ComposerPublication.RecoveryBlocked({ message })),
            ),
          ),
        )

      if (receipt) return remember(receipt)
      current.delete(storageKey)

      return writable
    })

  const change = (storageKey: string, update: () => boolean) =>
    !submitting.has(storageKey) &&
    ComposerPublication.$is('Writable')(state(storageKey)) &&
    update()

  const submit = <E, R>(
    storageKey: string,
    draft: TweetDraft,
    publish: boolean,
    replying: boolean,
    request: Effect.Effect<{ readonly slug: string }, E, R>,
  ) =>
    Effect.suspend(() => {
      if (submitting.has(storageKey)) return Effect.succeed(null)
      const publication = state(storageKey)

      if (
        ComposerPublication.$is('Published')(publication) ||
        ComposerPublication.$is('PublicationUncertain')(publication) ||
        ComposerPublication.$is('RecoveryBlocked')(publication)
      )
        return Effect.succeed(null)
      const pending = ComposerPublication.$is('CleanupPending')(publication) ? publication : null

      if (pending && !publish) return Effect.succeed(null)
      submitting.add(storageKey)

      return submitComposerDraft(
        { principal, storageKey },
        pending?.snapshot ?? draft,
        publish,
        replying,
        request,
        pending
          ? ConfirmedPublication.make({
              principal,
              storageKey,
              version: 1,
              draft: pending.snapshot,
              slug: pending.slug,
              replying,
            })
          : null,
      ).pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            if (ComposerSubmission.$is('PublishedNotCleared')(outcome))
              current.set(
                storageKey,
                ComposerPublication.CleanupPending({
                  ...outcome,
                  snapshot: pending?.snapshot ?? draft,
                }),
              )

            if (ComposerSubmission.$is('Published')(outcome))
              current.set(storageKey, ComposerPublication.Published(outcome))

            if (ComposerSubmission.$is('PublicationOutcomeUncertain')(outcome))
              current.set(
                storageKey,
                ComposerPublication.PublicationUncertain({
                  draft,
                  message: outcome.message,
                  replying,
                }),
              )
          }),
        ),
        Effect.ensuring(Effect.sync(() => submitting.delete(storageKey))),
      )
    })

  return { state, change, submit, restore }
}
