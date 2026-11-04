import { Predicate } from 'effect'

import type { ComposerPublication } from './composerOwner'

export const canRecoverPublication = (publication: ComposerPublication) =>
  Predicate.isTagged(publication, 'PublicationUncertain') ||
  Predicate.isTagged(publication, 'RecoveryBlocked')

export const requestComposerRecovery = (
  publication: ComposerPublication,
  confirm: (
    prompt: { readonly title: string; readonly message: string },
    clear: () => void,
  ) => void,
  clear: () => void,
) => {
  if (!canRecoverPublication(publication)) return
  let confirmed = false
  confirm(
    {
      title: 'Clear publication recovery?',
      message:
        'A post or reply may already have been accepted, even if this recovery record is unreadable. Check your posts or the thread first. Clearing the record unlocks your saved draft and sending it again could create a duplicate. Only the local recovery record is removed. Your draft is kept and nothing is sent.',
    },
    () => {
      if (confirmed) return
      confirmed = true
      clear()
    },
  )
}
