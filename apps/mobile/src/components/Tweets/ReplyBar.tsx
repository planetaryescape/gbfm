import { radii } from '@gbfm/theme'
import { Pressable, Text, View } from 'react-native'

import { Glyph } from '@/icons/Glyph'
import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export function ReplyBar({
  onPress,
  label = 'Post your reply',
}: {
  readonly onPress: () => void
  readonly label?: string
}) {
  const colors = useThemeColors()

  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: withAlpha(colors.muted, 0.25),
        backgroundColor: colors.background,
      }}>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Reply to this tweet'
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minHeight: 44,
          paddingHorizontal: 12,
          borderRadius: radii.control,
          backgroundColor: colors.surface,
          opacity: pressed ? 0.7 : 1,
        })}>
        <Glyph name='reply' size={18} color={colors.muted} />
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 14 }}>{label}</Text>
      </Pressable>
    </View>
  )
}
