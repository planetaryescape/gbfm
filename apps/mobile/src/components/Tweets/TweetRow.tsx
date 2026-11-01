import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import type { Tweet } from '@/api/tweets'
import { withAlpha, useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { replyCountLabel } from '@/tweets/tweetText'

import { SwipeExclusion } from './SwipeExclusion'
import { TweetAuthor } from './TweetAuthor'
import { TweetBody } from './TweetBody'

export function TweetRow({ tweet }: { tweet: Tweet }) {
  const router = useRouter()
  const colors = useThemeColors()
  const replyCount = tweet.replyCount ?? 0
  const openThread = () => router.push({ pathname: '/tweet/[slug]', params: { slug: tweet.slug } })

  const meta = [
    tweet.music ? null : tweet.musicEntityType,
    replyCount > 0 ? replyCountLabel(replyCount) : null,
    ...(tweet.tags ?? []).slice(0, 2).map((tag) => `#${tag}`),
  ].filter(Boolean)

  return (
    <View
      style={{
        gap: 10,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: withAlpha(colors.muted, 0.25),
      }}>
      <SwipeExclusion>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Open tweet thread'
          onPress={openThread}
          style={{ minHeight: 44, justifyContent: 'center' }}>
          <TweetAuthor creator={tweet.creators?.[0]} createdAt={tweet.createdAt} />
        </Pressable>
      </SwipeExclusion>
      <TweetBody tweet={tweet} size='sm' />
      {meta.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {meta.map((item) => (
            <Text key={item} style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
              {item}
            </Text>
          ))}
        </View>
      ) : null}
      <SwipeExclusion>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='View tweet thread'
          onPress={openThread}
          style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: 12 }}>
            View thread →
          </Text>
        </Pressable>
      </SwipeExclusion>
    </View>
  )
}
