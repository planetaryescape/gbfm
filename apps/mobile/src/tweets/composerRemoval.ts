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
        'Already published. Retry cleanup without publishing again. Your recovery record stays on this device after closing. If confirmation could not be saved, you will need to check publication.',
    })),
    Match.tag('PublicationUncertain', ({ replying }) => ({
      title: replying ? 'Check the thread first' : 'Check the post first',
      message:
        'Publication may already have succeeded. Your local draft and recovery warning remain on this device after closing. Automatic resubmission stays blocked.',
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
