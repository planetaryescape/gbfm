import { radii } from '@gbfm/theme'
import { useState } from 'react'
import { Linking, Pressable, Text } from 'react-native'

import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { tweetLinkUrl } from '@/tweets/tweetContent'

import { SwipeExclusion } from './SwipeExclusion'

export function useTweetLink(href: string) {
  const [failed, setFailed] = useState(false)

  const open = async () => {
    const url = tweetLinkUrl(href)

    if (!url) {
      setFailed(true)

      return
    }

    try {
      await Linking.openURL(url)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }

  return { open, failed }
}

export function TweetLink({
  href,
  label,
  accessibilityLabel = label,
}: {
  readonly href: string
  readonly label: string
  readonly accessibilityLabel?: string
}) {
  const colors = useThemeColors()
  const { open, failed } = useTweetLink(href)

  return (
    <>
      <SwipeExclusion>
        <Pressable
          accessibilityRole='link'
          accessibilityLabel={accessibilityLabel}
          hitSlop={8}
          onPress={open}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: radii.control,
            borderWidth: 1,
            borderColor: withAlpha(colors.muted, 0.4),
            opacity: pressed ? 0.6 : 1,
          })}>
          <Text style={{ color: colors.text, fontFamily: fonts.mono, fontSize: 12 }}>
            {`${label} ↗`}
          </Text>
        </Pressable>
      </SwipeExclusion>
      {failed ? (
        <Text
          accessibilityRole='alert'
          style={{ color: colors.strong, fontFamily: fonts.mono, fontSize: 12 }}>
          Couldn't open this link. Tap to try again.
        </Text>
      ) : null}
    </>
  )
}
