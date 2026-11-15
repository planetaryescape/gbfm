import { stepPosition, type SpotlightStep } from '@gbfm/rich-content/spotlight'
import { Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

type Props = {
  readonly steps: ReadonlyArray<SpotlightStep>
  readonly current: number
  readonly label: string
}

export function SpotlightProgress({ steps, current, label }: Props) {
  const colors = useThemeColors()

  return (
    <View style={{ gap: 8, marginBottom: 24 }}>
      <Text
        style={{
          minHeight: 14,
          color: colors.muted,
          fontFamily: fonts.monoSemiBold,
          fontSize: 11,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}>
        {label}
      </Text>
      <View
        accessibilityRole='progressbar'
        accessibilityLabel='Reading progress'
        accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }}
        style={{ flexDirection: 'row', gap: 2 }}>
        {steps.map((step, index) => (
          <View
            key={stepPosition(step) ?? 'intro'}
            style={{
              flex: 1,
              height: 8,
              marginLeft: step.kind === 'chapter' ? 3 : 0,
              borderWidth: 1,
              borderColor: colors.strong,
              backgroundColor:
                index < current ? colors.strong : index === current ? colors.accent : 'transparent',
            }}
          />
        ))}
      </View>
    </View>
  )
}
