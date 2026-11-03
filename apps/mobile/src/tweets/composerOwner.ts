import { Data, Effect } from 'effect'

import { ComposerSubmission, submitComposerDraft } from './composerSubmission'
import type { TweetDraft } from './draft'

export type ComposerPublication =
  | { readonly _tag: 'Writable' }
  | Data.TaggedEnum<{
      CleanupPending: { readonly draft: TweetDraft; readonly slug: string }
      Published: { readonly slug: string }
      ReplyUncertain: { readonly draft: TweetDraft; readonly message: string }
    }>

const ComposerPublication = Data.taggedEnum<ComposerPublication>()

const writable = ComposerPublication.Writable()

export const composerControls = (
  publication: ComposerPublication,
  fresh: { readonly canSubmit: boolean; readonly canSave: boolean; readonly label: string },
) => {
  const editable = ComposerPublication.$is('Writable')(publication)
  const cleanupPending = ComposerPublication.$is('CleanupPending')(publication)
  const requiresThreadCheck = ComposerPublication.$is('ReplyUncertain')(publication)

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
      ReplyUncertain: () => 'Check thread',
    }),
    busyLabel: cleanupPending ? 'Clearing' : 'Saving',
  }
}

export const createComposerOwner = () => {
  let current: { readonly storageKey: string; readonly publication: ComposerPublication } | null =
    null

  const state = (storageKey: string) =>
    current?.storageKey === storageKey ? current.publication : writable

  const change = (storageKey: string, update: () => boolean) =>
    ComposerPublication.$is('Writable')(state(storageKey)) && update()

  const submit = Effect.fn('ComposerOwner.submit')(function* <E, R>(
    storageKey: string,
    draft: TweetDraft,
    publish: boolean,
    replying: boolean,
    request: Effect.Effect<{ readonly slug: string }, E, R>,
  ) {
    const publication = state(storageKey)

    if (
      ComposerPublication.$is('Published')(publication) ||
      ComposerPublication.$is('ReplyUncertain')(publication)
    )
      return null
    const pending = ComposerPublication.$is('CleanupPending')(publication) ? publication : null

    if (pending && !publish) return null

    const outcome = yield* submitComposerDraft(
      storageKey,
      pending?.draft ?? draft,
      publish,
      replying,
      request,
      pending?.slug ?? null,
    )

    if (ComposerSubmission.$is('PublishedNotCleared')(outcome))
      current = { storageKey, publication: ComposerPublication.CleanupPending(outcome) }

    if (ComposerSubmission.$is('Published')(outcome))
      current = { storageKey, publication: ComposerPublication.Published(outcome) }

    if (ComposerSubmission.$is('ReplyOutcomeUncertain')(outcome))
      current = {
        storageKey,
        publication: ComposerPublication.ReplyUncertain({ draft, message: outcome.message }),
      }

    return outcome
  })

  return { state, change, submit }
}
