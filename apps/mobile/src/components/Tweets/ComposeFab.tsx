import { Pressable } from 'react-native'

import { haptics } from '@/feedback/haptics'
import { Glyph } from '@/icons/Glyph'
import { useThemeColors } from '@/theme/colors'

const SIZE = 56

export function ComposeFab({ onPress }: { readonly onPress: () => void }) {
  const colors = useThemeColors()

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Write a tweet'
      onPress={() => {
        void haptics.tap()
        onPress()
      }}
      style={({ pressed }) => ({
        position: 'absolute',
        right: 16,
        bottom: 16,
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.controls.primary,
        shadowColor: colors.shadow,
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}>
      <Glyph name='compose' size={26} color={colors.controls.primaryForeground} />
    </Pressable>
  )
}
