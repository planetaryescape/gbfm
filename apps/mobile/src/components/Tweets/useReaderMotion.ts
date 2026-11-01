import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'

export function useReaderReducedMotion() {
  const initial = useReducedMotion()
  const [reduced, setReduced] = useState(initial)

  useEffect(() => {
    let active = true
    let changed = false

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      changed = true
      setReduced(value)
    })

    AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (active && !changed) setReduced(value)
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
