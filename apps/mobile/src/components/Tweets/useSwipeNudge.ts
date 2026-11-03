import { useIsFocused } from 'expo-router/react-navigation'
import { useEffect, useEffectEvent, useRef } from 'react'
import { Easing, type SharedValue, withSequence, withTiming } from 'react-native-reanimated'

const ENTRY_DELAY_MS = 700

const IDLE_DELAY_MS = 9000

const IDLE_NUDGES = 2

const nudge = (direction: -1 | 1) => {
  'worklet'
  const out = { duration: 170, easing: Easing.out(Easing.quad) }
  const back = { duration: 150, easing: Easing.inOut(Easing.quad) }

  return withSequence(
    withTiming(direction * 22, out),
    withTiming(0, back),
    withTiming(direction * 9, out),
    withTiming(0, back),
  )
}

export function useSwipeNudge({
  offset,
  direction,
  entry,
  enabled,
}: {
  readonly offset: SharedValue<number>
  readonly direction: -1 | 1 | null
  readonly entry: boolean
  readonly enabled: boolean
}) {
  const focused = useIsFocused()
  const restart = useRef<(() => void) | null>(null)
  const active = focused && enabled && direction !== null

  const bounce = useEffectEvent(() => {
    if (direction !== null) offset.set(nudge(direction))
  })

  useEffect(() => {
    if (!active) return undefined
    let nudges = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const wait = (delay: number) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        bounce()
        nudges += 1

        if (nudges < IDLE_NUDGES) wait(IDLE_DELAY_MS)
      }, delay)
    }

    restart.current = () => {
      nudges = 0
      wait(IDLE_DELAY_MS)
    }

    wait(entry ? ENTRY_DELAY_MS : IDLE_DELAY_MS)

    return () => {
      clearTimeout(timer)
      restart.current = null
    }
  }, [active, entry])

  return () => restart.current?.()
}
