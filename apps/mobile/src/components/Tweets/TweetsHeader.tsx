import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export function TweetsHeader({ children }: { readonly children?: ReactNode }) {
  const colors = useThemeColors()

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 8,
      }}>
      <Text
        accessibilityRole='header'
        maxFontSizeMultiplier={1.5}
        style={{ color: colors.accent, fontFamily: fonts.monoSemiBold, fontSize: 20 }}>
        Tweets
      </Text>
      {children}
    </View>
  )
}
