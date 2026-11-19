import { Pressable, Text, View } from 'react-native'

import { Glyph } from '@/icons/Glyph'
import type { GlyphName } from '@/icons/glyphs'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

function FloatingPill({
  label,
  glyph,
  primary,
  onPress,
}: {
  readonly label: string
  readonly glyph: GlyphName
  readonly primary: boolean
  readonly onPress: () => void
}) {
  const colors = useThemeColors()
  const foreground = primary ? colors.controls.primaryForeground : colors.controls.foreground

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityLiveRegion='polite'
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: primary ? colors.controls.primary : colors.controls.card,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.controls.border,
        shadowColor: colors.shadow,
        shadowOpacity: 0.3,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        opacity: pressed ? 0.8 : 1,
      })}>
      <Glyph name={glyph} size={14} color={foreground} />
      <Text style={{ color: foreground, fontFamily: fonts.monoSemiBold, fontSize: 13 }}>
        {label}
      </Text>
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
  if (!newerUnread && !canReturn) return null

  return (
    <View
      pointerEvents='box-none'
      style={{
        position: 'absolute',
        top: 8,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
      }}>
      {newerUnread ? (
        <FloatingPill label='New tweets' glyph='arrowUp' primary onPress={onLatest} />
      ) : null}
      {canReturn ? (
        <FloatingPill
          label='Back to where you were'
          glyph='arrowDown'
          primary={false}
          onPress={onReturn}
        />
      ) : null}
    </View>
  )
}
