import { usePreventRemove } from 'expo-router/react-navigation'
import { useState } from 'react'
import { Alert } from 'react-native'

import type { ComposerPublication } from './composerOwner'
import {
  composerRemovalWarning,
  continueComposerRemoval,
  requestComposerRemoval,
} from './composerRemoval'

export function useComposerRemoval(publication: ComposerPublication) {
  const [allowed, setAllowed] = useState(false)
  const warning = composerRemovalWarning(publication)

  const confirm = (continuation: () => void) =>
    requestComposerRemoval(
      warning,
      (prompt, confirm) => {
        Alert.alert(prompt.title, prompt.message, [
          { text: 'Keep open', style: 'cancel' },
          { text: 'Close anyway', onPress: confirm },
        ])
      },
      () => {
        setAllowed(true)
        continuation()
      },
    )

  const disablePrevention = usePreventRemove(!allowed && warning !== null, ({ repeat }) =>
    confirm(repeat),
  )

  const leave = (continuation: () => void) =>
    continueComposerRemoval(() => {
      setAllowed(true)
      disablePrevention()
    }, continuation)

  return { leave, requestRemoval: (continuation: () => void) => confirm(() => leave(continuation)) }
}
