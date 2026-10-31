import { Match, Predicate } from 'effect'
import { Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { keyedContent, splitInlineImages, type TweetInline as Inline } from '@/tweets/tweetContent'

import { SwipeExclusion } from './SwipeExclusion'
import { useTweetLink } from './TweetLink'
import { TweetImage } from './TweetMedia'

function InlineLink({ inline }: { readonly inline: Extract<Inline, { readonly _tag: 'Link' }> }) {
  const colors = useThemeColors()
  const { open, failed } = useTweetLink(inline.href)

  return (
    <Text
      accessibilityRole='link'
      onPress={(event) => {
        event.stopPropagation()
        void open()
      }}
      style={{ color: colors.accent, textDecorationLine: 'underline' }}>
      <InlineText inlines={inline.children} />
      {failed ? ' (couldn’t open link, tap to retry)' : ''}
    </Text>
  )
}

function InlineNode({ inline }: { readonly inline: Inline }) {
  const colors = useThemeColors()

  return Match.valueTags(inline, {
    Text: ({ value }) => <Text>{value}</Text>,
    InlineCode: ({ value }) => <Text style={{ backgroundColor: colors.surface }}>{value}</Text>,
    Strong: ({ children }) => (
      <Text style={{ fontFamily: fonts.monoSemiBold }}>
        <InlineText inlines={children} />
      </Text>
    ),
    Emphasis: ({ children }) => (
      <Text style={{ fontStyle: 'italic' }}>
        <InlineText inlines={children} />
      </Text>
    ),
    Delete: ({ children }) => (
      <Text style={{ textDecorationLine: 'line-through' }}>
        <InlineText inlines={children} />
      </Text>
    ),
    Link: (link) => <InlineLink inline={link} />,
    Image: () => null,
    Break: () => <Text>{'\n'}</Text>,
  })
}

function InlineText({ inlines }: { readonly inlines: ReadonlyArray<Inline> }) {
  return keyedContent(inlines).map(({ item, key }) => <InlineNode key={key} inline={item} />)
}

const hasLink = (inline: Inline): boolean =>
  Predicate.isTagged(inline, 'Link') || ('children' in inline && inline.children.some(hasLink))

export function TweetInlineContent({
  inlines,
  size,
}: {
  readonly inlines: ReadonlyArray<Inline>
  readonly size: number
}) {
  const colors = useThemeColors()

  return (
    <SwipeExclusion disabled={!inlines.some(hasLink)}>
      <View style={{ gap: 10 }}>
        {keyedContent(splitInlineImages(inlines)).map(({ item, key }) =>
          item.type === 'image' ? (
            <TweetImage key={key} src={item.image.src} alt={item.image.alt} link={item.link} />
          ) : (
            <Text
              key={key}
              selectable
              style={{
                color: colors.strong,
                fontFamily: fonts.mono,
                fontSize: size,
                lineHeight: size * 1.45,
              }}>
              <InlineText inlines={item.inlines} />
            </Text>
          ),
        )}
      </View>
    </SwipeExclusion>
  )
}
