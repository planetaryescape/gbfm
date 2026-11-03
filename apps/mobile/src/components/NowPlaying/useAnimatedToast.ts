import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated } from 'react-native'

import { presentToastNotice } from './toastPresentation'

export function useAnimatedToast<Notice extends { readonly message: string }>(
  notice: Notice | null,
) {
  const [progress] = useState(() => new Animated.Value(0))
  const [dismissedNotice, setDismissedNotice] = useState<Notice | null>(null)
  const message = notice !== dismissedNotice ? notice?.message : null

  useEffect(() => {
    if (!notice) return undefined

    return presentToastNotice(
      notice,
      {
        stop: () => progress.stopAnimation(),
        reset: () => progress.setValue(0),
        animate: (toValue, duration, complete) =>
          Animated.timing(progress, { toValue, duration, useNativeDriver: true }).start(
            ({ finished }) => complete?.(finished),
          ),
      },
      (message) => AccessibilityInfo.announceForAccessibility(message),
      setDismissedNotice,
    )
  }, [notice, progress])

  return { progress, message }
}
