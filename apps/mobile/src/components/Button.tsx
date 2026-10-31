import { controlMetrics, radii } from '@gbfm/theme'
import { ActivityIndicator, Pressable, Text } from 'react-native'

import { Glyph } from '@/icons/Glyph'
import type { GlyphName } from '@/icons/glyphs'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

type ButtonProps = {
  readonly label: string
  readonly onPress: () => void
  readonly variant?: 'primary' | 'secondary' | 'quiet' | 'destructive'
  readonly disabled?: boolean
  readonly busy?: boolean
  readonly accessibilityLabel?: string
  readonly role?: 'button' | 'link'
} & (
  | { readonly iconOnly: true; readonly glyph: GlyphName }
  | { readonly iconOnly?: false; readonly glyph?: GlyphName }
)

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  busy = false,
  accessibilityLabel,
  role = 'button',
  glyph,
  iconOnly = false,
}: ButtonProps) {
  const { controls } = useThemeColors()

  const { foreground, background } = {
    primary: { foreground: controls.primaryForeground, background: controls.primary },
    secondary: { foreground: controls.foreground, background: controls.card },
    quiet: { foreground: controls.foreground, background: 'transparent' },
    destructive: { foreground: controls.destructiveForeground, background: controls.destructive },
  }[variant]

  const blocked = disabled || busy

  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: controlMetrics.height,
        minWidth: controlMetrics.height,
        paddingHorizontal: iconOnly ? 0 : controlMetrics.paddingInline,
        paddingVertical: 10,
        borderRadius: radii.control,
        borderWidth: controlMetrics.borderWidth,
        borderColor: variant === 'secondary' ? controls.border : 'transparent',
        backgroundColor:
          pressed && (variant === 'secondary' || variant === 'quiet') ? controls.muted : background,
        opacity: blocked ? 0.5 : pressed ? 0.8 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: controlMetrics.gap,
      })}>
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : glyph ? (
        <Glyph name={glyph} size={controlMetrics.iconSize} color={foreground} />
      ) : null}
      {!iconOnly ? (
        <Text
          style={{
            color: foreground,
            fontFamily: fonts.monoSemiBold,
            fontSize: controlMetrics.fontSize,
            lineHeight: 20,
            flexShrink: 1,
            textAlign: 'center',
          }}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  )
}
