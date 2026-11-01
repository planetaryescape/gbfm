import { Match } from 'effect'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { keyedContent, type TweetBlock } from '@/tweets/tweetContent'

import { ReaderScrollView } from './SwipeExclusion'
import { TweetInlineContent } from './TweetInline'
import { TweetExternalCard } from './TweetMedia'
import { TweetMusicCard } from './TweetMusicCard'

function Block({ block, size }: { readonly block: TweetBlock; readonly size: number }): ReactNode {
  const colors = useThemeColors()

  const textStyle = {
    color: colors.strong,
    fontFamily: fonts.mono,
    fontSize: size,
    lineHeight: size * 1.45,
  }

  return Match.valueTags(block, {
    Paragraph: ({ children }) => <TweetInlineContent inlines={children} size={size} />,
    Heading: ({ children }) => <TweetInlineContent inlines={children} size={size + 2} />,
    Quote: ({ children }) => (
      <View style={{ borderLeftWidth: 2, borderColor: colors.muted, paddingLeft: 12 }}>
        <TweetBlocks blocks={children} size={size} />
      </View>
    ),
    CardGroup: ({ children }) => <TweetBlocks blocks={children} size={size} />,
    List: ({ items, ordered, start }) => (
      <View style={{ gap: 8 }}>
        {keyedContent(items).map(({ item, key }, index) => (
          <View key={key} style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={textStyle}>{ordered ? `${(start ?? 1) + index}.` : '•'}</Text>
            <View style={{ flex: 1 }}>
              <TweetBlocks blocks={item.children} size={size} />
            </View>
          </View>
        ))}
      </View>
    ),
    Code: ({ value }) => (
      <Text selectable style={{ ...textStyle, backgroundColor: colors.surface, padding: 12 }}>
        {value}
      </Text>
    ),
    ThematicBreak: () => <View style={{ height: 1, backgroundColor: colors.muted }} />,
    Table: ({ rows }) => (
      <ReaderScrollView horizontal>
        <View style={{ gap: 8 }}>
          {keyedContent(rows).map(({ item: row, key }) => (
            <View key={key} style={{ flexDirection: 'row', gap: 16 }}>
              {keyedContent(row).map(({ item: cell, key: cellKey }) => (
                <View key={cellKey} style={{ width: 160 }}>
                  <TweetInlineContent inlines={cell} size={size} />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ReaderScrollView>
    ),
    MusicEmbed: ({ music, blurb, showTracks }) => (
      <View style={{ gap: 10 }}>
        <TweetMusicCard
          music={{
            entity: {
              id: music.entityId ?? music.canonicalUrl,
              type: music.entityType,
              title: music.title,
              artistNames: music.artists,
              coverImageUrl: music.imageUrl,
            },
            links:
              music.links.length > 0
                ? music.links
                : [{ platform: 'website', url: music.canonicalUrl }],
          }}
        />
        {blurb ? <Text style={textStyle}>{blurb}</Text> : null}
        {showTracks
          ? keyedContent(music.tracks).map(({ item, key }) => (
              <Text key={key} style={textStyle}>
                {item.title}
              </Text>
            ))
          : null}
      </View>
    ),
    ExternalMediaEmbed: ({ provider, title, canonicalUrl }) => (
      <TweetExternalCard title={title} provider={provider} href={canonicalUrl} />
    ),
    Tracklist: ({ tracks }) => (
      <View style={{ gap: 6 }}>
        {keyedContent(tracks).map(({ item, key }) => (
          <Text key={key} style={textStyle}>
            {item.title}
          </Text>
        ))}
      </View>
    ),
    UnavailableEmbed: ({ label, href }) =>
      href ? (
        <TweetExternalCard title={label} provider='original content' href={href} />
      ) : (
        <Text style={textStyle}>{label}</Text>
      ),
    Unsupported: () => <Text style={textStyle}>This content isn't available in the app.</Text>,
  })
}

export function TweetBlocks({
  blocks,
  size,
}: {
  readonly blocks: ReadonlyArray<TweetBlock>
  readonly size: number
}): ReactNode {
  return (
    <View style={{ gap: 12 }}>
      {keyedContent(blocks).map(({ item, key }) => (
        <Block key={key} block={item} size={size} />
      ))}
    </View>
  )
}
