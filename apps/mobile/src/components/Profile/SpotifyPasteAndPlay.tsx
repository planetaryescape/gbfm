import { spotifyEntityFromUrl } from '@gbfm/spotify'
import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'

import { SpotifyEntityActions } from '@/spotify/SpotifyEntityActions'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

type Props = {
  onNotice: (message: string) => void
}

export function SpotifyPasteAndPlay({ onNotice }: Props) {
  const [url, setUrl] = useState('')
  const colors = useThemeColors()

  const trimmedUrl = url.trim()
  const entity = trimmedUrl.length > 0 ? spotifyEntityFromUrl(trimmedUrl) : null
  const showUnrecognized = trimmedUrl.length > 0 && !entity

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 13 }}>
        Paste a Spotify link
      </Text>
      <TextInput
        accessibilityLabel='Spotify track, album, or playlist link'
        autoCapitalize='none'
        autoCorrect={false}
        keyboardType='url'
        onChangeText={setUrl}
        placeholder='https://open.spotify.com/track/...'
        placeholderTextColor={`${colors.text}99`}
        returnKeyType='done'
        value={url}
        style={{
          minHeight: 44,
          paddingHorizontal: 12,
          color: colors.text,
          fontFamily: fonts.mono,
          borderColor: `${colors.muted}66`,
          borderWidth: 1,
          borderRadius: 4,
          fontSize: 14,
        }}
      />

      {showUnrecognized ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
          That doesn't look like a Spotify track, album, or playlist link.
        </Text>
      ) : null}

      {entity ? <SpotifyEntityActions url={trimmedUrl} onNotice={onNotice} /> : null}
    </View>
  )
}
