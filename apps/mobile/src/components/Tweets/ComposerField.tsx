import { Text, TextInput, View, type TextInputProps } from 'react-native'

import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export function ComposerField({
  label,
  hint,
  ...props
}: TextInputProps & {
  readonly label: string
  readonly hint?: string
}) {
  const colors = useThemeColors()

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.accent, fontFamily: fonts.monoSemiBold, fontSize: 12 }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={{
          color: colors.text,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: withAlpha(colors.muted, 0.35),
          borderRadius: 4,
          padding: 14,
          fontSize: 17,
          lineHeight: 25,
          minHeight: props.multiline ? 120 : 48,
          textAlignVertical: 'top',
        }}
        {...props}
      />
      {hint ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>{hint}</Text>
      ) : null}
    </View>
  )
}
