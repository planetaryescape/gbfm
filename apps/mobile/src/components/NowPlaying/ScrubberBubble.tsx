import { formatScrubberDelta, formatScrubberTime, type ScrubberPreview } from '@gbfm/player'
import { Text, useWindowDimensions, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

type Props = {
  readonly preview: ScrubberPreview
  readonly referenceSeconds: number
  readonly duration: number
  readonly x: number
  readonly width: number
}

export function ScrubberBubble({ preview, referenceSeconds, duration, x, width }: Props) {
  const colors = useThemeColors()
  const { fontScale } = useWindowDimensions()
  const time = formatScrubberTime(preview.seconds, duration)
  const delta = formatScrubberDelta(preview.seconds, referenceSeconds, duration)
  const characters = Math.max(formatScrubberTime(duration, duration).length + 1, delta.length)
  const bubbleWidth = Math.min(width, Math.max(160, characters * 13 + 24) * Math.min(fontScale, 2))
  const left = Math.max(0, Math.min(width - bubbleWidth, x - bubbleWidth / 2))

  return (
    <View
      pointerEvents='none'
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility='no-hide-descendants'
      style={{
        position: 'absolute',
        bottom: 80,
        left,
        width: bubbleWidth,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 4,
        borderRadius: 12,
        backgroundColor: colors.controls.foreground,
      }}>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.3}
        maxFontSizeMultiplier={2}
        style={{
          color: colors.controls.card,
          fontFamily: fonts.mono,
          fontVariant: ['tabular-nums'],
          fontSize: 20,
          textAlign: 'center',
        }}>
        {time}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.3}
        maxFontSizeMultiplier={2}
        style={{
          color: colors.controls.card,
          fontFamily: fonts.mono,
          fontVariant: ['tabular-nums'],
          fontSize: 13,
          textAlign: 'center',
        }}>
        {delta}
      </Text>
      <Text
        maxFontSizeMultiplier={2}
        style={{ color: colors.controls.card, fontSize: 11, textAlign: 'center' }}>
        {preview.fine ? 'Fine seeking' : 'Hold to fine-seek'}
      </Text>
    </View>
  )
}
