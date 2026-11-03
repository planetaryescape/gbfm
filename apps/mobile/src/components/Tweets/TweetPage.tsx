import { Pressable, Text, View } from 'react-native'

import type { Tweet } from '@/api/tweets'
import { Button } from '@/components/Button'
import { Glyph } from '@/icons/Glyph'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { tagLabel } from '@/tweets/tagText'
import { replyCountLabel } from '@/tweets/tweetText'

import { TweetAuthor } from './TweetAuthor'
import { TweetBody } from './TweetBody'

function ReplyAction({ count, onPress }: { readonly count: number; readonly onPress: () => void }) {
  const colors = useThemeColors()

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={count > 0 ? `View ${replyCountLabel(count)}` : 'Reply to this tweet'}
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 8,
        paddingVertical: 6,
        opacity: pressed ? 0.6 : 1,
      })}>
      <Glyph name='reply' size={18} color={colors.muted} />
      {count > 0 ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 13 }}>{count}</Text>
      ) : null}
    </Pressable>
  )
}

export function TweetPage({
  tweet,
  height,
  onReplies,
  onMore,
}: {
  readonly tweet: Tweet
  readonly height: number
  readonly onReplies: () => void
  readonly onMore: () => void
}) {
  const colors = useThemeColors()
  const tags = tweet.tags ?? []

  return (
    <View style={{ height, paddingHorizontal: 20, paddingTop: 12, gap: 16, overflow: 'hidden' }}>
      <TweetAuthor
        creator={tweet.creators?.[0]}
        createdAt={tweet.createdAt}
        trailing={
          <Button iconOnly glyph='more' variant='quiet' label='More actions' onPress={onMore} />
        }
      />
      <TweetBody tweet={tweet} />
      {tags.length > 0 ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
          {tags.map((tag) => `#${tagLabel(tag)}`).join('  ')}
        </Text>
      ) : null}
      <ReplyAction count={tweet.replyCount ?? 0} onPress={onReplies} />
    </View>
  )
}
