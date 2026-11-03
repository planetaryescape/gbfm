import type { ReactNode } from 'react'
import { Image, Text, View } from 'react-native'

import type { Tweet } from '@/api/tweets'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { formatTweetDate } from '@/tweets/tweetText'

type Creator = NonNullable<Tweet['creators']>[number]

const AVATAR_SIZE = 36

export function TweetAuthor({
  creator,
  createdAt,
  trailing = null,
}: {
  creator: Creator | undefined
  createdAt: string
  trailing?: ReactNode
}) {
  const colors = useThemeColors()

  const meta = [creator?.username ? `@${creator.username}` : null, formatTweetDate(createdAt)]
    .filter(Boolean)
    .join(' · ')

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {creator?.image ? (
        <Image
          source={{ uri: creator.image }}
          accessibilityIgnoresInvertColors
          style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: 4 }}
        />
      ) : (
        <View
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: 4,
            backgroundColor: colors.surface,
          }}
        />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 14 }}>
          {creator?.name ?? 'goosebumps.fm'}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
          {meta}
        </Text>
      </View>
      {trailing}
    </View>
  )
}
