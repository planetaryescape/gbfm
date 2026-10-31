import { useState } from 'react'
import { Linking, Text } from 'react-native'

import { Button } from '@/components/Button'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { tweetLinkUrl } from '@/tweets/tweetContent'

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

export function TweetLink({ href, label }: { readonly href: string; readonly label: string }) {
  const colors = useThemeColors()
  const { open, failed } = useTweetLink(href)

  return (
    <>
      <Button role='link' label={`${label} ↗`} accessibilityLabel={label} onPress={open} />
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
