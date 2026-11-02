import type { PropsWithChildren } from 'react'
import { View } from 'react-native'
import { SafeAreaView } from 'react-native-screens/experimental'

import { useThemeColors } from '@/theme/colors'

type ScreenProps = PropsWithChildren<{ readonly topInset?: boolean }>

export function Screen({ children, topInset = true }: ScreenProps) {
  const colors = useThemeColors()

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaView
        collapsable={false}
        edges={{ top: topInset, left: true, right: true, bottom: true }}
        style={{ flex: 1, backgroundColor: colors.background }}>
        {children}
      </SafeAreaView>
    </View>
  )
}
