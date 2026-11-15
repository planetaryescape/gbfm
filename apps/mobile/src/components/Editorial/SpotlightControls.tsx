import { Pressable, Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { SquareFrame } from './SquareFrame'

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
    <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
      <SquareFrame background={colors.background}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Previous'
          disabled={!canGoBack}
          onPress={onBack}
          style={{
            width: 48,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: canGoBack ? 1 : 0.35,
          }}>
          <Text style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 18 }}>
            ‹
          </Text>
        </Pressable>
      </SquareFrame>
      {hasNext ? (
        <View style={{ flex: 1 }}>
          <SquareFrame background={colors.strong}>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={nextTitle ? `Next: ${nextTitle}` : 'Next'}
              onPress={onNext}
              style={{
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 14,
                gap: 10,
              }}>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: colors.surface,
                    opacity: nextTitle ? 0.7 : 1,
                    fontFamily: fonts.monoSemiBold,
                    fontSize: nextTitle ? 10 : 14,
                    letterSpacing: 1.4,
                    textTransform: 'uppercase',
                  }}>
                  Next
                </Text>
                {nextTitle ? (
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.surface, fontFamily: fonts.monoSemiBold, fontSize: 13 }}>
                    {nextTitle}
                  </Text>
                ) : null}
              </View>
              <Text style={{ color: colors.surface, fontFamily: fonts.monoSemiBold, fontSize: 18 }}>
                ›
              </Text>
            </Pressable>
          </SquareFrame>
        </View>
      ) : null}
    </View>
  )
}
