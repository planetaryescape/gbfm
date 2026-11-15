import { Pressable, Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { bevel, SquareFrame } from './SquareFrame'

type Props = {
  readonly nextTitle: string | null
  readonly hasNext: boolean
  readonly canGoBack: boolean
  readonly onBack: () => void
  readonly onNext: () => void
}

export function SpotlightControls({ nextTitle, hasNext, canGoBack, onBack, onNext }: Props) {
  const colors = useThemeColors()

  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
      <SquareFrame style={{ flexDirection: 'row', gap: 8, padding: 6 }}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Previous'
          disabled={!canGoBack}
          onPress={onBack}
          style={({ pressed }) => [
            bevel(pressed, colors.background, colors.muted),
            {
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
              opacity: canGoBack ? 1 : 0.4,
            },
          ]}>
          <Text style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 18 }}>
            ‹
          </Text>
        </Pressable>
        {hasNext ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={nextTitle ? `Next: ${nextTitle}` : 'Next'}
            onPress={onNext}
            style={({ pressed }) => [
              bevel(pressed, colors.background, colors.muted),
              {
                flex: 1,
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 12,
                backgroundColor: colors.surface,
              },
            ]}>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.muted,
                  fontFamily: fonts.mono,
                  fontSize: nextTitle ? 10 : 14,
                }}>
                Next
              </Text>
              {nextTitle ? (
                <Text
                  numberOfLines={1}
                  style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 13 }}>
                  {nextTitle}
                </Text>
              ) : null}
            </View>
            <Text style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 18 }}>
              ›
            </Text>
          </Pressable>
        ) : null}
      </SquareFrame>
    </View>
  )
}
