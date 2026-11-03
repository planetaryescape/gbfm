import { Pressable, Text } from 'react-native'

import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export function ComposerButton({
  label,
  onPress,
  disabled = false,
  primary = false,
  destructive = false,
  compact = false,
}: {
  readonly label: string
  readonly onPress: () => void
  readonly disabled?: boolean
  readonly primary?: boolean
  readonly destructive?: boolean
  readonly compact?: boolean
}) {
  const colors = useThemeColors()

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: compact ? 32 : 48,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: compact ? 12 : 16,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: withAlpha(destructive ? colors.error : colors.accent, 0.4),
        backgroundColor: primary ? colors.accent : colors.surface,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}>
      <Text
        style={{
          color: destructive ? colors.error : primary ? colors.onAccent : colors.accent,
          fontFamily: fonts.monoSemiBold,
          fontSize: 13,
        }}>
        {label}
      </Text>
    </Pressable>
  )
}
