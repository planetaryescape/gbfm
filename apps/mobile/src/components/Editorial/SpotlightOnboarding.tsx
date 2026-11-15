import { Pressable, Text, type TextStyle, View } from 'react-native'

import {
  SpotifyConnectionState,
  useConnectSpotify,
  useSpotifyConnection,
} from '@/spotify/connection'
import { SpotifyIcon } from '@/spotify/SpotifyIcon'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { bevel, SquareFrame } from './SquareFrame'

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
  }

  return (
    <SquareFrame
      title={connected ? 'Spotify' : 'Listen as you read'}
      style={{ padding: 14, gap: 10 }}>
      {connected ? (
        <>
          <Text style={text}>Play and queue from any card as you read.</Text>
        </>
      ) : (
        <>
          <Text style={text}>
            Connect Spotify to play and queue the music in this post as you go. Playing needs
            Spotify Premium and an open Spotify app.
          </Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <Pressable
              accessibilityRole='button'
              disabled={connecting}
              onPress={() => void connect()}
              style={({ pressed }) => [
                bevel(pressed, colors.background, colors.muted),
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: colors.surface,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  opacity: connecting ? 0.6 : 1,
                },
              ]}>
              <SpotifyIcon size={14} />
              <Text style={title}>{connecting ? 'Connecting…' : 'Connect Spotify'}</Text>
            </Pressable>
          </View>
        </>
      )}
    </SquareFrame>
  )
}
