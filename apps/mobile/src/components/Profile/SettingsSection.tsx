import type { PropsWithChildren } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export function SettingsSection({
  title,
  children,
}: PropsWithChildren<{ readonly title: string }>) {
  const colors = useThemeColors()

  return (
    <View style={{ gap: 12 }}>
      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.monoSemiBold,
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
        {title}
      </Text>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: withAlpha(colors.muted, 0.2),
          overflow: 'hidden',
        }}>
        {children}
      </View>
    </View>
  )
}

export function SettingsRow({
  title,
  detail,
  onPress,
  destructive = false,
}: {
  readonly title: string
  readonly detail?: string
  readonly onPress?: () => void
  readonly destructive?: boolean
}) {
  const colors = useThemeColors()

  const content = (
    <>
      <View style={{ flex: 1, gap: 5 }}>
        <Text
          style={{
            color: destructive ? colors.error : colors.strong,
            fontSize: 16,
            fontWeight: '600',
          }}>
          {title}
        </Text>
        {detail ? (
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>{detail}</Text>
        ) : null}
      </View>
      {onPress ? (
        <Text accessibilityElementsHidden style={{ color: colors.muted, fontSize: 20 }}>
          ›
        </Text>
      ) : null}
    </>
  )

  const style = {
    padding: 16,
    minHeight: 64,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(colors.muted, 0.12),
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
