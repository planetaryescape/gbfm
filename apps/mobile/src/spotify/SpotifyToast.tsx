import { useState } from 'react'
import { Animated, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAnimatedToast } from '@/components/NowPlaying/useAnimatedToast'
import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export type SpotifyToastNotice = {
  readonly id: number
  readonly message: string
}

export const useSpotifyToast = () => {
  const [notice, setNotice] = useState<SpotifyToastNotice | null>(null)
  const notify = (message: string) => setNotice({ id: Date.now(), message })

  return { notice, notify }
}

export function SpotifyToast({ notice }: { notice: SpotifyToastNotice | null }) {
  const colors = useThemeColors()
  const insets = useSafeAreaInsets()
  const { progress, message } = useAnimatedToast(notice)

  if (!message) return null

  return (
    <Animated.View
      pointerEvents='none'
      accessibilityLiveRegion='polite'
      style={{
        position: 'absolute',
        left: 24,
        right: 24,
        bottom: insets.bottom + 24,
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
          borderRadius: 4,
          borderWidth: 1,
          borderColor: withAlpha(colors.accent, 0.35),
          backgroundColor: colors.surface,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}>
        <Text
          numberOfLines={2}
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
