import { radii } from '@gbfm/theme'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useNowPlaying } from '@/audio/NowPlayingProvider'
import { Glyph } from '@/icons/Glyph'
import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

const VISIBLE_MS = 2400

export function QueueToast() {
  const { queueNotice } = useNowPlaying()
  const colors = useThemeColors()
  const insets = useSafeAreaInsets()
  const [progress] = useState(() => new Animated.Value(0))
  const [dismissedNotice, setDismissedNotice] = useState<typeof queueNotice>(null)
  const message = queueNotice !== dismissedNotice ? queueNotice?.message : null

  useEffect(() => {
    if (!queueNotice) return undefined
    AccessibilityInfo.announceForAccessibility(queueNotice.message)
    progress.stopAnimation()
    progress.setValue(0)
    Animated.timing(progress, { toValue: 1, duration: 180, useNativeDriver: true }).start()

    const hide = setTimeout(() => {
      Animated.timing(progress, { toValue: 0, duration: 220, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setDismissedNotice(queueNotice)
        },
      )
    }, VISIBLE_MS)

    return () => clearTimeout(hide)
  }, [queueNotice, progress])

  if (!message) return null

  return (
    <Animated.View
      pointerEvents='none'
      accessibilityLiveRegion='polite'
      style={{
        position: 'absolute',
        left: 24,
        right: 24,
        bottom: insets.bottom + 120,
        alignItems: 'center',
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
        ],
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          maxWidth: '100%',
          borderRadius: radii.surface,
          borderWidth: 1,
          borderColor: withAlpha(colors.accent, 0.35),
          backgroundColor: colors.surface,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}>
        <Glyph name='check' size={12} color={colors.accent} />
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            color: colors.strong,
            fontFamily: fonts.mono,
            fontSize: 12,
          }}>
          {message}
        </Text>
      </View>
    </Animated.View>
  )
}
