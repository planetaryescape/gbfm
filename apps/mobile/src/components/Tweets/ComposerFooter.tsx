import { Pressable, Text, View } from 'react-native'

import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { TWEET_MAX_LENGTH } from '@/tweets/draft'

const COUNTER_THRESHOLD = 40

export function ComposerFooter({
  length,
  status,
  saveLabel,
  onSave,
}: {
  readonly length: number
  readonly status: { readonly tone: 'error' | 'success' | 'muted'; readonly text: string } | null
  readonly saveLabel: string | null
  readonly onSave: () => void
}) {
  const colors = useThemeColors()
  const remaining = TWEET_MAX_LENGTH - length
  const toneColor = { error: colors.error, success: colors.success, muted: colors.muted }

  return (
    <View
      style={{
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: withAlpha(colors.muted, 0.25),
      }}>
      {status ? (
        <Text
          accessibilityLiveRegion='polite'
          accessibilityRole={status.tone === 'error' ? 'alert' : undefined}
          style={{ color: toneColor[status.tone], fontFamily: fonts.mono, fontSize: 12 }}>
          {status.text}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}>
        {saveLabel ? (
          <Pressable
            accessibilityRole='button'
            hitSlop={8}
            onPress={onSave}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: 12 }}>
              {saveLabel}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        {remaining <= COUNTER_THRESHOLD ? (
          <Text
            accessibilityLabel={`${remaining} characters remaining`}
            style={{
              color: remaining < 0 ? colors.error : remaining <= 10 ? colors.warning : colors.muted,
              fontFamily: fonts.monoSemiBold,
              fontSize: 12,
            }}>
            {remaining}
          </Text>
        ) : null}
      </View>
    </View>
  )
}
