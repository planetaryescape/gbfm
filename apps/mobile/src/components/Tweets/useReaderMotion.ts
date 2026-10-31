import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'

export function useReaderReducedMotion() {
  const initial = useReducedMotion()
  const [reduced, setReduced] = useState(initial)

  useEffect(() => {
    let active = true
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (active) setReduced(value)
      },
      () => {},
    )

    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  return reduced
}
