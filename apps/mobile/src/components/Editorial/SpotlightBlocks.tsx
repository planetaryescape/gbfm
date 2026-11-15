import type { RichContentBlock } from '@gbfm/rich-content/schema'
import { youtubeVideoId } from '@gbfm/rich-content/spotlight'
import { Predicate } from 'effect'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'

import { TweetBlocks } from '@/components/Tweets/TweetBlocks'
import { InlineText, TweetInlineContent } from '@/components/Tweets/TweetInline'
import { mentionSegments, musicMentions } from '@/editorial/musicMentions'
import { useThemeColors } from '@/theme/colors'
import { keyedContent } from '@/tweets/tweetContent'

import { SpotlightBlockFlow } from './SpotlightBlockFlow'
import { SpotlightMusicCard } from './SpotlightMusicCard'
import { SpotlightVideo } from './SpotlightVideo'

type MusicEmbed = Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>

type Paragraph = Extract<RichContentBlock, { readonly _tag: 'Paragraph' }>

const TEXT_SIZE = 16

const HIGHLIGHT_MS = 2400

const musicIn = (blocks: ReadonlyArray<RichContentBlock>): ReadonlyArray<MusicEmbed> =>
  blocks.flatMap((block) => {
    if (Predicate.isTagged(block, 'MusicEmbed')) return [block]

    if (Predicate.isTagged(block, 'CardGroup')) return musicIn(block.children)

    return []
  })

type Context = {
  readonly music: ReadonlyArray<MusicEmbed>
  readonly highlighted: number | null
  readonly onMention: (reference: number) => void
}

function MentionParagraph({
  block,
  context,
}: {
  readonly block: Paragraph
  readonly context: Context
}) {
  const colors = useThemeColors()
  const titles = context.music.map((item) => item.music.title)

  return (
    <TweetInlineContent
      inlines={block.children}
      size={TEXT_SIZE}
      renderText={(inlines) =>
        keyedContent(inlines).map(({ item, key }) => {
          if (!Predicate.isTagged(item, 'Text')) return <InlineText key={key} inlines={[item]} />

          const matches = musicMentions(item.value, titles)

          if (matches.length === 0) return <Text key={key}>{item.value}</Text>

          return (
            <Text key={key}>
              {mentionSegments(item.value, matches).map((segment) =>
                segment.reference === null ? (
                  <Text key={segment.start}>{segment.text}</Text>
                ) : (
                  <Text
                    key={segment.start}
                    accessibilityRole='button'
                    accessibilityHint='Highlights this record below'
                    onPress={() =>
                      segment.reference !== null && context.onMention(segment.reference)
                    }
                    style={{
                      textDecorationLine: 'underline',
                      textDecorationColor: colors.accentSurface,
                      textDecorationStyle: 'dotted',
                    }}>
                    {segment.text}
                  </Text>
                ),
              )}
            </Text>
          )
        })
      }
    />
  )
}

function SpotlightBlock({
  block,
  context,
}: {
  readonly block: RichContentBlock
  readonly context: Context
}) {
  if (Predicate.isTagged(block, 'MusicEmbed'))
    return (
      <SpotlightMusicCard
        block={block}
        highlighted={context.highlighted === context.music.indexOf(block)}
      />
    )

  if (Predicate.isTagged(block, 'CardGroup')) return <SpotlightBlocks blocks={block.children} />

  if (Predicate.isTagged(block, 'Paragraph') && context.music.length > 0)
    return <MentionParagraph block={block} context={context} />

  if (Predicate.isTagged(block, 'ExternalMediaEmbed') && block.provider === 'youtube') {
    const id = youtubeVideoId(block.canonicalUrl)

    if (id) return <SpotlightVideo id={id} title={block.title} canonicalUrl={block.canonicalUrl} />
  }

  return <TweetBlocks blocks={[block]} size={TEXT_SIZE} />
}

export function SpotlightBlocks({ blocks }: { readonly blocks: ReadonlyArray<RichContentBlock> }) {
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const music = musicIn(blocks)

  useEffect(() => {
    const timer = highlighted === null ? null : setTimeout(() => setHighlighted(null), HIGHLIGHT_MS)

    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [highlighted])

  const context: Context = { music, highlighted, onMention: setHighlighted }

  return (
    <View style={{ gap: 20 }}>
      <SpotlightBlockFlow
        blocks={blocks}
        renderMusic={(block, compact) => (
          <SpotlightMusicCard
            block={block}
            compact={compact}
            highlighted={highlighted === music.indexOf(block)}
          />
        )}
        renderBlock={(block) => <SpotlightBlock block={block} context={context} />}
        renderRow={(children, count) => (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {children}
            {count === 1 ? <View style={{ flex: 1 }} /> : null}
          </View>
        )}
      />
    </View>
  )
}
