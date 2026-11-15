import { radii } from '@gbfm/theme'
import { Pressable, Text, View } from 'react-native'

import { Glyph } from '@/icons/Glyph'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

type Props = {
  readonly label: string
  readonly position: string
  readonly announcement: string
  readonly canGoBack: boolean
  readonly nextTitle: string | null
  readonly onBack: () => void
  readonly onNext: () => void
}

function StepButton({
  glyph,
  label,
  disabled,
  onPress,
}: {
  readonly glyph: 'chevronLeft' | 'chevronRight'
  readonly label: string
  readonly disabled: boolean
  readonly onPress: () => void
}) {
  const colors = useThemeColors()

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.control,
        backgroundColor: pressed ? `${colors.muted}26` : 'transparent',
        opacity: disabled ? 0.35 : 1,
      })}>
      <Glyph name={glyph} size={20} color={colors.strong} />
    </Pressable>
  )
}

export function SpotlightHeader({
  label,
  position,
  announcement,
  canGoBack,
  nextTitle,
  onBack,
  onNext,
}: Props) {
  const colors = useThemeColors()

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderBottomWidth: 1,
        borderColor: `${colors.muted}26`,
        backgroundColor: colors.background,
      }}>
      <View
        accessible
        accessibilityLabel={announcement}
        accessibilityLiveRegion='polite'
        style={{
          flex: 1,
          marginLeft: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}>
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: colors.muted,
            fontFamily: fonts.mono,
            fontSize: 12,
          }}>
          {label}
        </Text>
        {position ? (
          <Text
            style={{ flexShrink: 0, color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
            {position}
          </Text>
        ) : null}
      </View>
      <StepButton
        glyph='chevronLeft'
        label='Previous entry'
        disabled={!canGoBack}
        onPress={onBack}
      />
      <StepButton
        glyph='chevronRight'
        label={nextTitle ? `Next entry: ${nextTitle}` : 'End of article'}
        disabled={nextTitle === null}
        onPress={onNext}
      />
    </View>
  )
}
