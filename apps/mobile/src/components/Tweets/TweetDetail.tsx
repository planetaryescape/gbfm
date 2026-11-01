import { radii } from '@gbfm/theme'
import { Text, View } from 'react-native'

import type { TweetScreenPost } from '@/api/tweets'
import { withAlpha, useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { replyCountLabel } from '@/tweets/tweetText'

import { ReaderScrollView } from './SwipeExclusion'
import { TweetAuthor } from './TweetAuthor'
import { TweetBody } from './TweetBody'
import { TweetRow } from './TweetRow'

type Props = {
  readonly post: TweetScreenPost
  readonly parent: TweetScreenPost | null
  readonly quote: TweetScreenPost | null
  readonly replies: ReadonlyArray<TweetScreenPost>
}

function SectionLabel({ children }: { children: string }) {
  const colors = useThemeColors()

  return (
    <Text style={{ color: colors.muted, fontFamily: fonts.monoSemiBold, fontSize: 13 }}>
      {children}
    </Text>
  )
}

export function TweetDetail({ post, parent, quote, replies }: Props) {
  const colors = useThemeColors()

  return (
    <ReaderScrollView
      contentInsetAdjustmentBehavior='automatic'
      contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: 32, gap: 16 }}>
      {parent ? (
        <View style={{ gap: 4, opacity: 0.85 }}>
          <SectionLabel>thread start</SectionLabel>
          <TweetRow tweet={parent} />
        </View>
      ) : null}

      <TweetAuthor creator={post.creators?.[0]} createdAt={post.createdAt} />
      <TweetBody tweet={post} />

      {quote ? (
        <View
          style={{
            borderRadius: radii.surface,
            borderWidth: 1,
            borderColor: withAlpha(colors.muted, 0.5),
            paddingHorizontal: 12,
          }}>
          <TweetRow tweet={quote} />
        </View>
      ) : null}

      {post.tags && post.tags.length > 0 ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
          {post.tags.map((tag) => `#${tag}`).join('  ')}
        </Text>
      ) : null}

      <View style={{ gap: 4, marginTop: 8 }}>
        <SectionLabel>
          {replies.length > 0 ? replyCountLabel(replies.length) : 'no replies yet'}
        </SectionLabel>
        {replies.map((reply) => (
          <TweetRow key={reply.id} tweet={reply} />
        ))}
      </View>
    </ReaderScrollView>
  )
}
