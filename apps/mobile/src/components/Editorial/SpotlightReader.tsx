import type { RichContentBlock } from '@gbfm/rich-content/schema'
import {
  headingText,
  spotlightSteps,
  spotlightStructure,
  stepAt,
  stepPosition,
  stepTitle,
  type SpotlightChapter,
  type SpotlightStep as Step,
} from '@gbfm/rich-content/spotlight'
import { useFocusEffect } from 'expo-router'
import { type ComponentRef, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Platform, ScrollView, Text, View } from 'react-native'
import Animated, { FadeIn, FadeInLeft, FadeInRight } from 'react-native-reanimated'

import { useReaderReducedMotion } from '@/components/Tweets/useReaderMotion'
import { stepTo } from '@/editorial/progressState'
import { readSpotlightProgress, saveSpotlightProgress } from '@/editorial/spotlightProgress'
import { useEditorial } from '@/editorial/useEditorial'
import { useStepAnnouncement } from '@/editorial/useStepAnnouncement'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { SpotlightBlocks } from './SpotlightBlocks'
import { SpotlightHeader } from './SpotlightHeader'
import { SpotlightOnboarding } from './SpotlightOnboarding'
import { SpotlightStep } from './SpotlightStep'

type Direction = 'none' | 'forward' | 'backward'

const contentStyle = { padding: 16, paddingBottom: 48 }

const announceStep = (label: string) => {
  if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(label)
}

const entering = (direction: Direction) => {
  if (direction === 'forward') return FadeInRight.duration(220)

  if (direction === 'backward') return FadeInLeft.duration(220)

  return FadeIn.duration(160)
}

const stepLabel = (step: Step | undefined, chapters: ReadonlyArray<SpotlightChapter>) => {
  if (step?.kind === 'moment') {
    const chapter = chapters[step.chapter]

    return {
      heading: chapter ? headingText(chapter.heading) : '',
      position: `${step.position + 1} / ${chapter?.moments.length ?? 0}`,
      announcement: `${chapter ? headingText(chapter.heading) : ''}, entry ${step.position + 1} of ${chapter?.moments.length ?? 0}: ${headingText(step.value.heading)}`,
    }
  }

  if (step?.kind === 'chapter')
    return {
      heading: headingText(step.value.heading),
      position: `Chapter ${step.chapter + 1} / ${chapters.length}`,
      announcement: `Chapter ${step.chapter + 1} of ${chapters.length}: ${headingText(step.value.heading)}`,
    }
  const heading = step?.kind === 'end' ? 'End of article' : 'Introduction'

  return { heading, position: '', announcement: heading }
}

function Title({ children }: { readonly children: string }) {
  const colors = useThemeColors()

  return (
    <Text
      style={{
        color: colors.strong,
        fontFamily: fonts.monoSemiBold,
        fontSize: 30,
        lineHeight: 36,
        marginBottom: 20,
      }}>
      {children}
    </Text>
  )
}

function Walk({
  slug,
  title,
  blocks,
}: {
  readonly slug: string
  readonly title: string
  readonly blocks: ReadonlyArray<RichContentBlock>
}) {
  const structure = useMemo(() => spotlightStructure(blocks), [blocks])
  const steps = useMemo(() => spotlightSteps(structure), [structure])
  const [progress, setProgress] = useState(() => readSpotlightProgress(slug))
  const [direction, setDirection] = useState<Direction>('none')
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  const current = stepAt(steps, progress.at)
  const step = steps[current]
  const next = steps[current + 1]
  const label = stepLabel(step, structure.chapters)
  const reduced = useReaderReducedMotion()
  useFocusEffect(useStepAnnouncement(label.announcement, announceStep))

  const goTo = (at: string | null) => {
    const index = stepAt(steps, at)
    const updated = stepTo(at)

    let direction: Direction = 'none'

    if (index > current) direction = 'forward'

    if (index < current) direction = 'backward'
    setDirection(direction)
    setProgress(updated)
    saveSpotlightProgress(slug, updated)
    scroll.current?.scrollTo({ y: 0, animated: false })
  }

  const go = (index: number) => {
    const target = steps[index]

    goTo(target ? stepPosition(target) : null)
  }

  return (
    <View style={{ flex: 1 }}>
      <SpotlightHeader
        label={label.heading}
        position={label.position}
        announcement={label.announcement}
        canGoBack={current > 0}
        nextTitle={next ? stepTitle(next, structure.chapters) : null}
        onBack={() => go(current - 1)}
        onNext={() => go(current + 1)}
      />
      <ScrollView ref={scroll} contentContainerStyle={contentStyle}>
        {current === 0 ? <Title>{title}</Title> : null}
        {step ? (
          <Animated.View key={current} {...(reduced ? {} : { entering: entering(direction) })}>
            <SpotlightStep
              step={step}
              onStart={() => go(current === steps.length - 1 ? 0 : 1)}
              onPosition={goTo}
              onboarding={<SpotlightOnboarding />}
            />
          </Animated.View>
        ) : null}
      </ScrollView>
    </View>
  )
}

function Message({ children }: { readonly children: string }) {
  const colors = useThemeColors()

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 14 }}>{children}</Text>
    </View>
  )
}

export function SpotlightReader({ slug }: { readonly slug: string }) {
  const state = useEditorial(slug)

  if (state.status === 'loading') return <Message>Loading…</Message>

  if (state.status === 'missing') return <Message>This post is not available.</Message>

  if (state.status === 'unavailable') return <Message>Could not load this post. Try again.</Message>

  const document = state.post.richContent
  const blocks = document?.blocks ?? []

  if (document?.layout === 'spotlight')
    return <Walk slug={slug} title={state.post.title} blocks={blocks} />

  return (
    <ScrollView contentContainerStyle={contentStyle}>
      <Title>{state.post.title}</Title>
      <SpotlightBlocks blocks={blocks} />
    </ScrollView>
  )
}
