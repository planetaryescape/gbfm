import { radii } from '@gbfm/theme'
import { Children, type PropsWithChildren } from 'react'
import { Pressable, Text, useWindowDimensions, View } from 'react-native'

import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export function SettingsSection({
  title,
  children,
}: PropsWithChildren<{ readonly title: string }>) {
  const colors = useThemeColors()

  return (
    <View style={{ gap: 10 }}>
      <Text
        accessibilityRole='header'
        style={{
          color: colors.muted,
          fontFamily: fonts.monoSemiBold,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
        {title}
      </Text>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radii.surface,
          borderWidth: 1,
          borderColor: withAlpha(colors.muted, 0.2),
          overflow: 'hidden',
        }}>
        {Children.map(Children.toArray(children), (child, index) => (
          <View
            style={{
              borderTopWidth: index === 0 ? 0 : 0.5,
              borderTopColor: withAlpha(colors.muted, 0.18),
            }}>
            {child}
          </View>
        ))}
      </View>
    </View>
  )
}

export function SettingsRow({
  title,
  detail,
  value,
  onPress,
  destructive = false,
}: {
  readonly title: string
  readonly detail?: string
  readonly value?: string
  readonly onPress?: () => void
  readonly destructive?: boolean
}) {
  const colors = useThemeColors()
  const { fontScale } = useWindowDimensions()
  const stackValue = fontScale >= 1.5

  const content = (
    <>
      <View style={{ flex: 1, gap: 5 }}>
        <Text
          style={{
            color: destructive ? colors.error : colors.strong,
            fontFamily: fonts.monoSemiBold,
            fontSize: 14,
            lineHeight: 21,
          }}>
          {title}
        </Text>
        {detail ? (
          <Text
            style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 }}>
            {detail}
          </Text>
        ) : null}
        {value && stackValue ? (
          <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>{value}</Text>
        ) : null}
      </View>
      {value && !stackValue ? (
        <Text
          style={{
            color: colors.muted,
            fontFamily: fonts.mono,
            fontSize: 12,
            flexShrink: 1,
            textAlign: 'right',
          }}>
          {value}
        </Text>
      ) : null}
      {onPress && !destructive ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility='no'
          maxFontSizeMultiplier={1.5}
          style={{ color: colors.muted, fontSize: 20 }}>
          ›
        </Text>
      ) : null}
    </>
  )

  const style = {
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 54,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  }

  return onPress ? (
    <Pressable
      accessibilityRole='button'
      onPress={onPress}
      style={({ pressed }) => ({ ...style, opacity: pressed ? 0.65 : 1 })}>
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  )
}
