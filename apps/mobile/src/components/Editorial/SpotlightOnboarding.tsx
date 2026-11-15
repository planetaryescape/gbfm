import { Pressable, Text, type TextStyle, View } from 'react-native'

import {
  SpotifyConnectionState,
  useConnectSpotify,
  useSpotifyConnection,
} from '@/spotify/connection'
import { SPOTIFY_GREEN } from '@/spotify/SpotifyIcon'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { SquareFrame } from './SquareFrame'

export function SpotlightOnboarding() {
  const colors = useThemeColors()
  const connection = useSpotifyConnection((state) => state)
  const connect = useConnectSpotify()
  const connected = SpotifyConnectionState.$is('Connected')(connection)
  const connecting = SpotifyConnectionState.$is('Connecting')(connection)
  const text = { color: colors.strong, fontFamily: fonts.mono, fontSize: 14, lineHeight: 21 }

  const title: TextStyle = {
    color: colors.strong,
    fontFamily: fonts.monoSemiBold,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  }

  return (
    <SquareFrame background={`${colors.accent}1a`} style={{ padding: 14, gap: 10 }}>
      {connected ? (
        <>
          <Text style={title}>Spotify connected</Text>
          <Text style={text}>Play and queue from any card as you read.</Text>
        </>
      ) : (
        <>
          <Text style={title}>Listen as you read</Text>
          <Text style={text}>
            Connect Spotify to play and queue the music in this post as you go. Playing needs
            Spotify Premium and an open Spotify app.
          </Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <Pressable
              accessibilityRole='button'
              disabled={connecting}
              onPress={() => void connect()}
              style={{
                borderWidth: 2,
                borderColor: colors.strong,
                backgroundColor: SPOTIFY_GREEN,
                paddingHorizontal: 14,
                paddingVertical: 10,
                opacity: connecting ? 0.6 : 1,
              }}>
              <Text style={{ ...title, color: '#000', fontSize: 12 }}>
                {connecting ? 'Connecting…' : 'Connect Spotify'}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </SquareFrame>
  )
}
