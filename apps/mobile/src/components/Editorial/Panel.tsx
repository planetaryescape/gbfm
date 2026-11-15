import { radii } from '@gbfm/theme'
import type { PropsWithChildren } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'

import { useThemeColors } from '@/theme/colors'

type Props = PropsWithChildren<{
  readonly highlighted?: boolean
  readonly style?: StyleProp<ViewStyle>
}>

export function Panel({ highlighted = false, style, children }: Props) {
  const colors = useThemeColors()

  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderRadius: radii.surface,
          borderColor: highlighted ? colors.accentSurface : `${colors.muted}40`,
          backgroundColor: highlighted ? `${colors.accentSurface}14` : colors.surface,
        },
        style,
      ]}>
      {children}
    </View>
  )
}
