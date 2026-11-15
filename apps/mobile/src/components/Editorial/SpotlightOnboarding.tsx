import { radii } from '@gbfm/theme'
import { Pressable, Text } from 'react-native'

import {
  SpotifyConnectionState,
  useConnectSpotify,
  useSpotifyConnection,
} from '@/spotify/connection'
import { SpotifyIcon } from '@/spotify/SpotifyIcon'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { Panel } from './Panel'

export function SpotlightOnboarding() {
  const colors = useThemeColors()
  const connection = useSpotifyConnection((state) => state)
  const connect = useConnectSpotify()
  const connected = SpotifyConnectionState.$is('Connected')(connection)
  const connecting = SpotifyConnectionState.$is('Connecting')(connection)
  const text = { color: colors.strong, fontFamily: fonts.mono, fontSize: 14, lineHeight: 21 }

  return (
    <Panel style={{ padding: 16, gap: 10 }}>
      <Text style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 14 }}>
        {connected ? 'Spotify connected' : 'Listen as you read'}
      </Text>
      {connected ? (
        <Text style={text}>Play, queue and save from any card as you read.</Text>
      ) : (
        <>
          <Text style={text}>
            Connect Spotify to play, queue and save the music in this post as you go. Playing needs
            Spotify Premium and an open Spotify app.
          </Text>
          <Pressable
            accessibilityRole='button'
            disabled={connecting}
            onPress={() => void connect()}
            style={({ pressed }) => ({
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderWidth: 1,
              borderRadius: radii.control,
              borderColor: `${colors.muted}60`,
              backgroundColor: pressed ? `${colors.muted}20` : colors.surface,
              opacity: connecting ? 0.6 : 1,
            })}>
            <SpotifyIcon size={14} />
            <Text style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 13 }}>
              {connecting ? 'Connecting…' : 'Connect Spotify'}
            </Text>
          </Pressable>
        </>
      )}
    </Panel>
  )
}
