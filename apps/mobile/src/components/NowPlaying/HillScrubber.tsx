import { scrubberCurve, scrubberProgress, startScrubberDrag } from '@gbfm/player'
import { useRef, useState } from 'react'
import type { AccessibilityActionEvent, GestureResponderEvent } from 'react-native'
import { Text, View } from 'react-native'
import Animated, {
  createAnimatedComponent,
  useAnimatedStyle,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'

import { haptics } from '@/feedback/haptics'
import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

const time = (seconds: number) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0

  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`
}

type Props = {
  readonly currentTime: number
  readonly duration: number
  readonly onSeek: (seconds: number) => void
}

const AnimatedCircle = createAnimatedComponent(Circle)

const AnimatedPath = createAnimatedComponent(Path)

export function HillScrubber({ currentTime, duration, onSeek }: Props) {
  const colors = useThemeColors()
  const [preview, setPreview] = useState<number | null>(null)

  const gesture = useRef<{
    width: number
    origin: number
    seconds: number
    drag: ReturnType<typeof startScrubberDrag> | null
  }>({ width: 0, origin: 0, seconds: 0, drag: null })

  const pressed = useSharedValue(0)
  const reducedMotion = useReducedMotion()
  const enabled = Number.isFinite(duration) && duration > 0
  const position = preview ?? currentTime
  const curve = scrubberCurve(scrubberProgress(position, duration))

  const motion = useAnimatedStyle(() => ({
    transform: [{ translateY: -pressed.get() }],
  }))

  const thumbMotion = useAnimatedProps(() => ({ r: 6 + pressed.get() }))
  const trackMotion = useAnimatedProps(() => ({ strokeWidth: 12 + pressed.get() }))

  const acknowledge = (value: number) => {
    pressed.set(reducedMotion ? value : withSpring(value, { damping: 18, stiffness: 260 }))
  }

  const move = (event: GestureResponderEvent) => {
    const drag = gesture.current.drag

    if (!drag) return
    const seconds = drag.timeAt(event.nativeEvent.pageX - gesture.current.origin)

    gesture.current.seconds = seconds
    setPreview(seconds)
  }

  const finish = () => {
    acknowledge(0)
    gesture.current.drag = null
    setPreview(null)
  }

  const adjust = (event: AccessibilityActionEvent) => {
    if (!enabled) return

    if (event.nativeEvent.actionName === 'increment') onSeek(Math.min(duration, currentTime + 15))

    if (event.nativeEvent.actionName === 'decrement') onSeek(Math.max(0, currentTime - 15))
  }

  return (
    <View style={{ gap: 6 }}>
      <View
        testID='hill-scrubber'
        accessible
        accessibilityRole='adjustable'
        accessibilityLabel='Playback position'
        accessibilityHint='Drag or tap to seek. Swipe up or down to seek 15 seconds.'
        accessibilityState={{ disabled: !enabled }}
        accessibilityValue={{
          min: 0,
          max: enabled ? Math.round(duration) : 0,
          now: enabled ? Math.round(scrubberProgress(position, duration) * duration) : 0,
          text: `${time(position)} of ${time(duration)}`,
        }}
        accessibilityActions={[
          { name: 'increment', label: 'Seek forward 15 seconds' },
          { name: 'decrement', label: 'Seek backward 15 seconds' },
        ]}
        onAccessibilityAction={adjust}
        onLayout={(event) => {
          gesture.current.width = event.nativeEvent.layout.width
        }}
        onStartShouldSetResponder={() => enabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => {
          gesture.current.origin = event.nativeEvent.pageX - event.nativeEvent.locationX
          gesture.current.drag = startScrubberDrag(
            event.nativeEvent.locationX,
            gesture.current.width,
            currentTime,
            duration,
          )
          void haptics.select()
          acknowledge(1)
          move(event)
        }}
        onResponderMove={move}
        onResponderRelease={(event) => {
          move(event)
          onSeek(gesture.current.seconds)
          finish()
        }}
        onResponderTerminate={finish}
        style={{ height: 64, opacity: enabled ? 1 : 0.4 }}>
        <Animated.View pointerEvents='none' style={[{ height: 64 }, motion]}>
          <Svg width='100%' height={64} viewBox='0 0 320 64' preserveAspectRatio='none'>
            <AnimatedPath
              animatedProps={trackMotion}
              d={curve.track}
              fill='none'
              stroke={withAlpha(colors.muted, 0.35)}
              strokeLinecap='round'
            />
            <AnimatedPath
              animatedProps={trackMotion}
              d={curve.played}
              fill='none'
              stroke={colors.accent}
              strokeLinecap='round'
            />
            <AnimatedCircle animatedProps={thumbMotion} cx={curve.x} cy={44} fill={colors.accent} />
          </Svg>
        </Animated.View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>
          {time(position)}
        </Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>
          -{time(duration - position)}
        </Text>
      </View>
    </View>
  )
}
