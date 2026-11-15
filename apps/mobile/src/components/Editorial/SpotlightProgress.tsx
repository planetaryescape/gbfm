import { stepPosition, type SpotlightStep } from '@gbfm/rich-content/spotlight'
import { Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { bevel } from './SquareFrame'

type Props = {
  readonly steps: ReadonlyArray<SpotlightStep>
  readonly current: number
  readonly label: string
}

export function SpotlightProgress({ steps, current, label }: Props) {
  const colors = useThemeColors()

  return (
    <View style={{ gap: 6, marginBottom: 24 }}>
      <Text style={{ minHeight: 14, color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>
        {label}
      </Text>
      <View
        accessibilityRole='progressbar'
        accessibilityLabel='Reading progress'
        accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }}
        style={[
          bevel(true, colors.surface, colors.muted),
          {
            flexDirection: 'row',
            gap: 2,
            padding: 2,
            borderColor: colors.strong,
            backgroundColor: colors.background,
          },
        ]}>
        {steps.map((step, index) => (
          <View
            key={stepPosition(step) ?? 'intro'}
            style={{
              flex: 1,
              height: 9,
              marginLeft: step.kind === 'chapter' ? 3 : 0,
              backgroundColor: index <= current ? colors.accentSurface : 'transparent',
            }}
          />
        ))}
      </View>
    </View>
  )
}
