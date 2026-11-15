import type { PropsWithChildren } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'

import { useThemeColors } from '@/theme/colors'

export const SHADOW_OFFSET = 4

type Props = PropsWithChildren<{
  readonly background?: string
  readonly style?: StyleProp<ViewStyle>
}>

export function SquareFrame({ background, style, children }: Props) {
  const colors = useThemeColors()

  return (
    <View style={{ marginRight: SHADOW_OFFSET, marginBottom: SHADOW_OFFSET }}>
      <View
        style={{
          position: 'absolute',
          top: SHADOW_OFFSET,
          left: SHADOW_OFFSET,
          right: -SHADOW_OFFSET,
          bottom: -SHADOW_OFFSET,
          backgroundColor: colors.strong,
        }}
      />
      <View
        style={[
          {
            borderWidth: 2,
            borderColor: colors.strong,
            backgroundColor: background ?? colors.surface,
          },
          style,
        ]}>
        {children}
      </View>
    </View>
  )
}
