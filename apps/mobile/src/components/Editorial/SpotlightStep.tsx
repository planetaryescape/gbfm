import {
  headingText,
  type SpotlightChapter,
  type SpotlightStep as Step,
} from '@gbfm/rich-content/spotlight'
import { radii } from '@gbfm/theme'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Glyph } from '@/icons/Glyph'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { SpotlightBlocks } from './SpotlightBlocks'

type Props = {
  readonly step: Step
  readonly onStart: () => void
  readonly onPosition: (at: string) => void
  readonly onboarding: ReactNode
}

function BigHeading({ children }: { readonly children: string }) {
  const colors = useThemeColors()

  return (
    <Text
      style={{
        color: colors.strong,
        fontFamily: fonts.monoSemiBold,
        fontSize: 32,
        lineHeight: 38,
      }}>
      {children}
    </Text>
  )
}

function StartButton({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const colors = useThemeColors()

  return (
    <Pressable
      accessibilityRole='button'
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingLeft: 18,
        paddingRight: 12,
        paddingVertical: 10,
        borderRadius: radii.control,
        backgroundColor: colors.strong,
        opacity: pressed ? 0.8 : 1,
      })}>
      <Text style={{ color: colors.surface, fontFamily: fonts.monoSemiBold, fontSize: 15 }}>
        {label}
      </Text>
      <Glyph name='chevronRight' size={18} color={colors.surface} />
    </Pressable>
  )
}

function ChapterEntries({
  chapter,
  index,
  onPosition,
}: {
  readonly chapter: SpotlightChapter
  readonly index: number
  readonly onPosition: (at: string) => void
}) {
  const colors = useThemeColors()

  return (
    <View style={{ borderTopWidth: 1, borderColor: `${colors.muted}30` }}>
      {chapter.moments.map((moment, position) => (
        <Pressable
          key={`${index + 1}.${position + 1}`}
          accessibilityRole='button'
          onPress={() => onPosition(`${index + 1}.${position + 1}`)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderColor: `${colors.muted}30`,
            backgroundColor: pressed ? `${colors.muted}14` : 'transparent',
          })}>
          <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 13 }}>
            {String(position + 1).padStart(2, '0')}
          </Text>
          <Text style={{ flex: 1, color: colors.strong, fontFamily: fonts.mono, fontSize: 15 }}>
            {headingText(moment.heading)}
          </Text>
          <Glyph name='chevronRight' size={16} color={colors.muted} />
        </Pressable>
      ))}
    </View>
  )
}

export function SpotlightStep({ step, onStart, onPosition, onboarding }: Props) {
  const colors = useThemeColors()

  if (step.kind === 'intro')
    return (
      <View style={{ gap: 24 }}>
        <SpotlightBlocks blocks={step.blocks} />
        {onboarding}
        <StartButton label='Start' onPress={onStart} />
      </View>
    )

  if (step.kind === 'end')
    return (
      <View style={{ gap: 20, paddingVertical: 24 }}>
        <BigHeading>That's the walk.</BigHeading>
        <StartButton label='Start over' onPress={onStart} />
      </View>
    )

  if (step.kind === 'chapter')
    return (
      <View style={{ gap: 20 }}>
        <BigHeading>{headingText(step.value.heading)}</BigHeading>
        <SpotlightBlocks blocks={step.value.lead} />
        {step.value.moments.length > 0 ? (
          <ChapterEntries chapter={step.value} index={step.chapter} onPosition={onPosition} />
        ) : null}
      </View>
    )

  return (
    <View style={{ gap: 18 }}>
      <Text
        style={{
          color: colors.strong,
          fontFamily: fonts.monoSemiBold,
          fontSize: 24,
          lineHeight: 30,
        }}>
        {headingText(step.value.heading)}
      </Text>
      <SpotlightBlocks blocks={step.value.blocks} />
    </View>
  )
}
