import { radii } from '@gbfm/theme'
import { Pressable, Text, View } from 'react-native'

import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { tagLabel } from '@/tweets/tagText'

export function ComposerTagSuggestions({
  suggestions,
  onPick,
}: {
  readonly suggestions: ReadonlyArray<string>
  readonly onPick: (tag: string) => void
}) {
  const colors = useThemeColors()

  if (suggestions.length === 0) return null

  return (
    <View
      accessibilityRole='menu'
      style={{
        borderRadius: radii.surface,
        borderWidth: 1,
        borderColor: withAlpha(colors.muted, 0.35),
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}>
      {suggestions.map((tag, index) => (
        <Pressable
          key={tag}
          accessibilityRole='menuitem'
          onPress={() => onPick(tag)}
          style={({ pressed }) => ({
            minHeight: 44,
            justifyContent: 'center',
            paddingHorizontal: 14,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: withAlpha(colors.muted, 0.2),
            backgroundColor: pressed ? withAlpha(colors.accent, 0.12) : 'transparent',
          })}>
          <Text style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: 15 }}>
            #{tagLabel(tag)}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}
