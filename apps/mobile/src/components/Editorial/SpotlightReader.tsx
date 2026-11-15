import type { RichContentBlock } from '@gbfm/rich-content/schema'
import {
  headingText,
  spotlightSteps,
  spotlightStructure,
  stepAt,
  stepPosition,
  stepTitle,
} from '@gbfm/rich-content/spotlight'
import { type ComponentRef, useMemo, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { stepTo } from '@/editorial/progressState'
import { readSpotlightProgress, saveSpotlightProgress } from '@/editorial/spotlightProgress'
import { useEditorial } from '@/editorial/useEditorial'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { SpotlightBlocks } from './SpotlightBlocks'
import { SpotlightControls } from './SpotlightControls'
import { SpotlightOnboarding } from './SpotlightOnboarding'
import { SpotlightProgress } from './SpotlightProgress'
import { SpotlightStep } from './SpotlightStep'

const contentStyle = { padding: 16, paddingBottom: 32 }

function Title({ children }: { readonly children: string }) {
  const colors = useThemeColors()

  return (
    <Text
      style={{
        color: colors.strong,
        fontFamily: fonts.monoSemiBold,
        fontSize: 30,
        lineHeight: 36,
        marginBottom: 16,
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
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  const current = stepAt(steps, progress.at)
  const step = steps[current]
  const next = steps[current + 1]

  const go = (index: number) => {
    const target = steps[index]
    const updated = stepTo(progress, target ? stepPosition(target) : null)

    setProgress(updated)
    saveSpotlightProgress(slug, updated)
    scroll.current?.scrollTo({ y: 0, animated: false })
  }

  const label =
    step?.kind === 'moment'
      ? [
          `Chapter ${step.chapter + 1}`,
          headingText(structure.chapters[step.chapter]?.heading ?? step.value.heading),
          `${step.position + 1} of ${structure.chapters[step.chapter]?.moments.length ?? 0}`,
        ].join(' · ')
      : ''

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroll} contentContainerStyle={contentStyle}>
        {current === 0 ? <Title>{title}</Title> : null}
        <SpotlightProgress steps={steps} current={current} label={label} />
        {step ? (
          <SpotlightStep
            key={current}
            step={step}
            chapters={structure.chapters}
            seen={progress.seen}
            onStart={() => go(current === steps.length - 1 ? 0 : 1)}
            onboarding={<SpotlightOnboarding />}
          />
        ) : null}
      </ScrollView>
      {current > 0 ? (
        <SpotlightControls
          nextTitle={next && step?.kind !== 'chapter' ? stepTitle(next, structure.chapters) : null}
          hasNext={next !== undefined}
          canGoBack={current > 0}
          onBack={() => go(current - 1)}
          onNext={() => go(current + 1)}
        />
      ) : null}
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
