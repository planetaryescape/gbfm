import type { RichContentBlock } from '@gbfm/rich-content/schema'
import { youtubeVideoId } from '@gbfm/rich-content/spotlight'
import { Predicate } from 'effect'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'

import { TweetBlocks } from '@/components/Tweets/TweetBlocks'
import { InlineText } from '@/components/Tweets/TweetInline'
import { mentionSegments, musicMentions } from '@/editorial/musicMentions'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { keyedContent } from '@/tweets/tweetContent'

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

/** Consecutive records sit together in a grid, as on the web walk. */
const groupRecords = (blocks: ReadonlyArray<RichContentBlock>) => {
  const groups: Array<Array<RichContentBlock>> = []

  for (const block of blocks) {
    const previous = groups.at(-1)

    if (
      Predicate.isTagged(block, 'MusicEmbed') &&
      previous?.[0] &&
      Predicate.isTagged(previous[0], 'MusicEmbed')
    )
      previous.push(block)
    else groups.push([block])
  }

  return groups
}

const pairs = <A,>(items: ReadonlyArray<A>) => {
  const rows: Array<ReadonlyArray<A>> = []

  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2))

  return rows
}

type Context = {
  readonly music: ReadonlyArray<MusicEmbed>
  readonly highlighted: number | null
  readonly onMention: (reference: number) => void
}

function RecordGrid({
  cards,
  context,
}: {
  readonly cards: ReadonlyArray<RichContentBlock>
  readonly context: Context
}) {
  return (
    <View style={{ gap: 12 }}>
      {keyedContent(pairs(cards)).map(({ item: row, key }) => (
        <View key={key} style={{ flexDirection: 'row', gap: 12 }}>
          {keyedContent(row).map(({ item, key: cardKey }) =>
            Predicate.isTagged(item, 'MusicEmbed') ? (
              <SpotlightMusicCard
                key={cardKey}
                block={item}
                compact
                highlighted={context.highlighted === context.music.indexOf(item)}
              />
            ) : null,
          )}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  )
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
    <Text
      selectable
      style={{
        color: colors.strong,
        fontFamily: fonts.mono,
        fontSize: TEXT_SIZE,
        lineHeight: TEXT_SIZE * 1.45,
      }}>
      {keyedContent(block.children).map(({ item, key }) => {
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
                  onPress={() => segment.reference !== null && context.onMention(segment.reference)}
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
      })}
    </Text>
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

  if (Predicate.isTagged(block, 'CardGroup'))
    return <RecordGrid cards={block.children} context={context} />

  if (Predicate.isTagged(block, 'Paragraph') && context.music.length > 0)
    return <MentionParagraph block={block} context={context} />

  if (Predicate.isTagged(block, 'ExternalMediaEmbed') && block.provider === 'youtube') {
    const id = youtubeVideoId(block.canonicalUrl)

    if (id) return <SpotlightVideo id={id} title={block.title} />
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
      {keyedContent(groupRecords(blocks)).map(({ item: group, key }) =>
        group.length > 1 ? (
          <RecordGrid key={key} cards={group} context={context} />
        ) : group[0] ? (
          <SpotlightBlock key={key} block={group[0]} context={context} />
        ) : null,
      )}
    </View>
  )
}
