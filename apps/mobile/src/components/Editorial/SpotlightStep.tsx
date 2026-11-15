import {
  headingText,
  type SpotlightChapter,
  type SpotlightStep as Step,
} from '@gbfm/rich-content/spotlight'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { SpotlightBlocks } from './SpotlightBlocks'
import { bevel } from './SquareFrame'

type Props = {
  readonly step: Step
  readonly chapters: ReadonlyArray<SpotlightChapter>
  readonly seen: ReadonlyArray<string>
  readonly onStart: () => void
  readonly onboarding: ReactNode
}

function Eyebrow({ children }: { readonly children: string }) {
  const colors = useThemeColors()

  return (
    <Text
      style={{
        color: colors.accent,
        fontFamily: fonts.mono,
        fontSize: 13,
      }}>
      {children}
    </Text>
  )
}

function BigHeading({ children }: { readonly children: string }) {
  const colors = useThemeColors()

  return (
    <Text
      style={{
        color: colors.strong,
        fontFamily: fonts.monoSemiBold,
        fontSize: 34,
        lineHeight: 38,
      }}>
      {children}
    </Text>
  )
}

function StartButton({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const colors = useThemeColors()

  return (
    <View
      style={{ alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.strong, padding: 2 }}>
      <Pressable
        accessibilityRole='button'
        onPress={onPress}
        style={({ pressed }) => [
          bevel(pressed, colors.background, colors.muted),
          { paddingHorizontal: 22, paddingVertical: 10, backgroundColor: colors.surface },
        ]}>
        <Text style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 15 }}>
          {label}
        </Text>
      </Pressable>
    </View>
  )
}

function ChapterMoments({
  chapter,
  index,
  seen,
}: {
  readonly chapter: SpotlightChapter
  readonly index: number
  readonly seen: ReadonlyArray<string>
}) {
  const colors = useThemeColors()

  return (
    <View
      style={[
        bevel(true, colors.surface, colors.muted),
        { borderColor: colors.strong, backgroundColor: colors.background, padding: 2 },
      ]}>
      {chapter.moments.map((moment, position) => (
        <View
          key={`${index + 1}.${position + 1}`}
          style={{
            flexDirection: 'row',
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderTopWidth: position === 0 ? 0 : 1,
            borderStyle: 'dotted',
            borderColor: colors.muted,
          }}>
          <Text style={{ color: colors.accent, fontFamily: fonts.monoSemiBold, fontSize: 14 }}>
            {String(position + 1).padStart(2, '0')}
          </Text>
          <Text style={{ flex: 1, color: colors.strong, fontFamily: fonts.mono, fontSize: 14 }}>
            {headingText(moment.heading)}
          </Text>
          {seen.includes(`${index + 1}.${position + 1}`) ? (
            <Text accessibilityLabel='Read' style={{ color: colors.muted }}>
              ✓
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  )
}

export function SpotlightStep({ step, chapters, seen, onStart, onboarding }: Props) {
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
        <Eyebrow>The end</Eyebrow>
        <BigHeading>That's the walk.</BigHeading>
        <StartButton label='Start over' onPress={onStart} />
      </View>
    )

  if (step.kind === 'chapter')
    return (
      <View style={{ gap: 20 }}>
        <View style={{ gap: 10 }}>
          <Eyebrow>{`Chapter ${step.chapter + 1} of ${chapters.length}`}</Eyebrow>
          <BigHeading>{headingText(step.value.heading)}</BigHeading>
        </View>
        <SpotlightBlocks blocks={step.value.lead} />
        {step.value.moments.length > 0 ? (
          <ChapterMoments chapter={step.value} index={step.chapter} seen={seen} />
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
