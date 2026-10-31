import { radii } from '@gbfm/theme'
import { useState } from 'react'
import { Image, Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { tweetLinkUrl, type TweetInline } from '@/tweets/tweetContent'

import { SwipeExclusion } from './SwipeExclusion'
import { TweetLink } from './TweetLink'

export function TweetImage({
  src,
  alt,
  link = null,
}: {
  readonly src: string
  readonly alt: string
  readonly link?: Pick<Extract<TweetInline, { readonly _tag: 'Link' }>, 'href' | 'title'> | null
}) {
  const colors = useThemeColors()
  const [failed, setFailed] = useState(false)
  const [aspectRatio, setAspectRatio] = useState(1.5)
  const uri = tweetLinkUrl(src)

  return (
    <SwipeExclusion>
      <View style={{ gap: 8 }}>
        {failed || !uri || !uri.startsWith('http') ? (
          <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 13 }}>
            {alt || 'Image unavailable'}
          </Text>
        ) : (
          <Image
            source={{ uri }}
            accessibilityLabel={alt || 'Tweet image'}
            onError={() => setFailed(true)}
            onLoad={({ nativeEvent }) => {
              if (nativeEvent.source.width > 0 && nativeEvent.source.height > 0)
                setAspectRatio(nativeEvent.source.width / nativeEvent.source.height)
            }}
            resizeMode='contain'
            style={{
              width: '100%',
              aspectRatio,
              maxHeight: 420,
              backgroundColor: colors.surface,
              borderRadius: radii.surface,
            }}
          />
        )}
        <TweetLink href={src} label='Open image' />
        {link ? <TweetLink href={link.href} label='Open link' /> : null}
      </View>
    </SwipeExclusion>
  )
}

export function TweetExternalCard({
  title,
  provider,
  href,
}: {
  readonly title: string
  readonly provider: string
  readonly href: string
}) {
  const colors = useThemeColors()

  return (
    <View
      style={{
        gap: 10,
        padding: 14,
        borderRadius: radii.surface,
        borderWidth: 1,
        borderColor: colors.muted,
        backgroundColor: colors.surface,
      }}>
      <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>{provider}</Text>
      <Text style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 15 }}>
        {title}
      </Text>
      <TweetLink href={href} label={`Open ${provider}`} />
    </View>
  )
}
