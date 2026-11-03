import { Match } from 'effect'

import type { ComposerPublication } from './composerOwner'

type RemovalWarning = { readonly title: string; readonly message: string }

export const continueComposerRemoval = (
  disablePrevention: () => void,
  continuation: () => void,
) => {
  disablePrevention()
  continuation()
}

export const composerRemovalWarning = (publication: ComposerPublication) =>
  Match.value(publication).pipe(
    Match.tag('CleanupPending', () => ({
      title: 'Already published',
      message:
        'Retry cleanup before closing. If you close now, check your published post before posting again.',
    })),
    Match.tag('ReplyUncertain', () => ({
      title: 'Check the thread first',
      message:
        'Your reply may already be published. Closing keeps your local draft but loses this warning. Check the thread before trying to reply again.',
    })),
    Match.orElse(() => null),
  )

export const requestComposerRemoval = (
  warning: RemovalWarning | null,
  showWarning: (warning: RemovalWarning, confirm: () => void) => void,
  continueRemoval: () => void,
) => {
  if (!warning) {
    continueRemoval()

    return
  }

  let confirmed = false
  showWarning(warning, () => {
    if (confirmed) return
    confirmed = true
    continueRemoval()
  })
}
