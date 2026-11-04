import { Alert } from 'react-native'

import type { ComposerPublication } from '@/tweets/composerOwner'
import { canRecoverPublication, requestComposerRecovery } from '@/tweets/composerRecovery'

import { ComposerButton } from './ComposerButton'

export function ComposerRecovery({
  publication,
  busy,
  onRecover,
}: {
  readonly publication: ComposerPublication
  readonly busy: boolean
  readonly onRecover: () => void
}) {
  if (busy || !canRecoverPublication(publication)) return null

  return (
    <ComposerButton
      label='Review recovery options'
      onPress={() =>
        requestComposerRecovery(
          publication,
          (prompt, confirm) =>
            Alert.alert(prompt.title, prompt.message, [
              { text: 'Keep recovery record', style: 'cancel' },
              { text: 'Clear recovery record', style: 'destructive', onPress: confirm },
            ]),
          onRecover,
        )
      }
    />
  )
}
