import { Pressable, Text, View } from 'react-native'

import { Glyph } from '@/icons/Glyph'
import type { GlyphName } from '@/icons/glyphs'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

function HeaderLink({
  label,
  glyph,
  color,
  onPress,
}: {
  readonly label: string
  readonly glyph: GlyphName
  readonly color: string
  readonly onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        opacity: pressed ? 0.6 : 1,
      })}>
      <Glyph name={glyph} size={12} color={color} />
      <Text style={{ color, fontFamily: fonts.monoSemiBold, fontSize: 12 }}>{label}</Text>
    </Pressable>
  )
}

export function ReadingProgress({
  newerUnread,
  canReturn,
  onLatest,
  onReturn,
}: {
  readonly newerUnread: boolean
  readonly canReturn: boolean
  readonly onLatest: () => void
  readonly onReturn: () => void
}) {
  const colors = useThemeColors()

  if (!newerUnread && !canReturn) return null

  return (
    <View
      accessibilityLiveRegion='polite'
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      {canReturn ? (
        <HeaderLink label='Back' glyph='arrowDown' color={colors.muted} onPress={onReturn} />
      ) : null}
      {newerUnread ? (
        <HeaderLink label='New tweets' glyph='arrowUp' color={colors.accent} onPress={onLatest} />
      ) : null}
    </View>
  )
}
