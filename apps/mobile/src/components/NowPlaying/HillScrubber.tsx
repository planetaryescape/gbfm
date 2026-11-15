import { formatScrubberTime, scrubberCurve, scrubberProgress } from '@gbfm/player'
import type { AccessibilityActionEvent } from 'react-native'
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

import { ScrubberBubble } from './ScrubberBubble'
import { useHillScrubberGesture } from './useHillScrubberGesture'

type Props = {
  readonly currentTime: number
  readonly duration: number
  readonly onSeek: (seconds: number) => void
}

const AnimatedCircle = createAnimatedComponent(Circle)

const AnimatedPath = createAnimatedComponent(Path)

export function HillScrubber({ currentTime, duration, onSeek }: Props) {
  const colors = useThemeColors()
  const pressed = useSharedValue(0)
  const reducedMotion = useReducedMotion()
  const enabled = Number.isFinite(duration) && duration > 0

  const gesture = useHillScrubberGesture({
    currentTime,
    duration,
    onSeek,
    onPressChange: (value) => {
      pressed.set(reducedMotion ? value : withSpring(value, { damping: 18, stiffness: 260 }))
    },
  })

  const position = gesture.feedback?.preview.seconds ?? currentTime
  const curve = scrubberCurve(scrubberProgress(position, duration))

  const motion = useAnimatedStyle(() => ({
    transform: [{ translateY: -pressed.get() }],
  }))

  const thumbMotion = useAnimatedProps(() => ({ r: 6 + pressed.get() }))
  const trackMotion = useAnimatedProps(() => ({ strokeWidth: 12 + pressed.get() }))

  const adjust = (event: AccessibilityActionEvent) => {
    if (!enabled) return

    const increments = new Map([
      ['increment', 15],
      ['decrement', -15],
      ['seekForwardFine', 5],
      ['seekBackwardFine', -5],
    ])

    const increment = increments.get(event.nativeEvent.actionName)

    if (increment === undefined) return
    gesture.cancel()
    onSeek(Math.max(0, Math.min(duration, currentTime + increment)))
    void haptics.select()
  }

  return (
    <View style={{ gap: 6 }}>
      <View
        testID='hill-scrubber'
        accessible
        accessibilityRole='adjustable'
        accessibilityLabel='Playback position'
        accessibilityHint='Drag or tap to seek. Hold still for fine seeking. Swipe up or down to seek 15 seconds. Actions offer 5-second seeking.'
        accessibilityState={{ disabled: !enabled }}
        accessibilityValue={{
          min: 0,
          max: enabled ? Math.round(duration) : 0,
          now: enabled ? Math.round(scrubberProgress(position, duration) * duration) : 0,
          text: `${formatScrubberTime(position, duration)} of ${formatScrubberTime(duration, duration)}`,
        }}
        accessibilityActions={[
          { name: 'increment', label: 'Seek forward 15 seconds' },
          { name: 'decrement', label: 'Seek backward 15 seconds' },
          { name: 'seekForwardFine', label: 'Seek forward 5 seconds' },
          { name: 'seekBackwardFine', label: 'Seek backward 5 seconds' },
        ]}
        onAccessibilityAction={adjust}
        onLayout={gesture.onLayout}
        onStartShouldSetResponder={() => enabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={gesture.start}
        onResponderMove={gesture.move}
        onResponderRelease={gesture.release}
        onResponderTerminate={gesture.cancel}
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
        {gesture.feedback && (
          <ScrubberBubble
            preview={gesture.feedback.preview}
            referenceSeconds={gesture.feedback.referenceSeconds}
            duration={duration}
            x={gesture.feedback.x}
            width={gesture.width}
          />
        )}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>
          {formatScrubberTime(position, duration)}
        </Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>
          -{formatScrubberTime(duration - position, duration)}
        </Text>
      </View>
    </View>
  )
}
