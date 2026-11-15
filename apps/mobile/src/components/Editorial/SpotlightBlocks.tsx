import type { RichContentBlock } from '@gbfm/rich-content/schema'
import { youtubeVideoId } from '@gbfm/rich-content/spotlight'
import { Predicate } from 'effect'
import { ScrollView, View } from 'react-native'

import { TweetBlocks } from '@/components/Tweets/TweetBlocks'
import { keyedContent } from '@/tweets/tweetContent'

import { SpotlightMusicCard } from './SpotlightMusicCard'
import { SpotlightVideo } from './SpotlightVideo'

const TEXT_SIZE = 16

function CardRow({ blocks }: { readonly blocks: ReadonlyArray<RichContentBlock> }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12 }}>
      {keyedContent(blocks).map(({ item, key }) =>
        Predicate.isTagged(item, 'MusicEmbed') ? (
          <SpotlightMusicCard key={key} block={item} compact />
        ) : (
          <TweetBlocks key={key} blocks={[item]} size={TEXT_SIZE} />
        ),
      )}
    </ScrollView>
  )
}

function SpotlightBlock({ block }: { readonly block: RichContentBlock }) {
  if (Predicate.isTagged(block, 'MusicEmbed')) return <SpotlightMusicCard block={block} />

  if (Predicate.isTagged(block, 'CardGroup')) return <CardRow blocks={block.children} />

  if (Predicate.isTagged(block, 'ExternalMediaEmbed') && block.provider === 'youtube') {
    const id = youtubeVideoId(block.canonicalUrl)

    if (id) return <SpotlightVideo id={id} title={block.title} url={block.canonicalUrl} />
  }

  return <TweetBlocks blocks={[block]} size={TEXT_SIZE} />
}

export function SpotlightBlocks({ blocks }: { readonly blocks: ReadonlyArray<RichContentBlock> }) {
  return (
    <View style={{ gap: 20 }}>
      {keyedContent(blocks).map(({ item, key }) => (
        <SpotlightBlock key={key} block={item} />
      ))}
    </View>
  )
}
