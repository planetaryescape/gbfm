import { Alert, Text, TouchableOpacity, View } from 'react-native'

import {
  SpotifyConnectionState,
  useConnectSpotify,
  useDisconnectSpotify,
  useSpotifyConnection,
} from '@/spotify/connection'
import { SPOTIFY_GREEN, SpotifyIcon } from '@/spotify/SpotifyIcon'
import { SpotifyToast, useSpotifyToast } from '@/spotify/SpotifyToast'
import { useThemeColors } from '@/theme/colors'

import { SpotifyPasteAndPlay } from './SpotifyPasteAndPlay'

export function SpotifySection() {
  const connection = useSpotifyConnection((state) => state)
  const connect = useConnectSpotify()
  const disconnect = useDisconnectSpotify()
  const colors = useThemeColors()
  const { notice, notify } = useSpotifyToast()

  return (
    <View className='mb-8' style={{ position: 'relative' }}>
      <View className='flex-row items-center gap-2 mb-2'>
        <SpotifyIcon size={16} />
        <Text style={{ color: colors.strong, fontSize: 20, fontWeight: '700' }}>Spotify</Text>
      </View>

      {SpotifyConnectionState.$is('Bootstrapping')(connection) ? (
        <Text style={{ color: colors.muted, fontSize: 14 }}>Checking session...</Text>
      ) : SpotifyConnectionState.$is('Connected')(connection) ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 4,
            padding: 16,
            gap: 12,
          }}>
          <View>
            <Text style={{ color: colors.strong, fontSize: 16, fontWeight: '600' }}>
              {connection.profile?.display_name ?? connection.profile?.id ?? 'Connected'}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
              Connected for playback and music links
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole='button'
            accessibilityLabel='Disconnect Spotify'
            onPress={() =>
              Alert.alert('Disconnect Spotify?', 'You can reconnect at any time.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Disconnect', style: 'destructive', onPress: disconnect },
              ])
            }
            style={{
              borderColor: colors.error,
              borderWidth: 1,
              borderRadius: 4,
              paddingVertical: 10,
              alignItems: 'center',
            }}>
            <Text style={{ color: colors.error, fontSize: 14, fontWeight: '600' }}>Disconnect</Text>
          </TouchableOpacity>

          <SpotifyPasteAndPlay onNotice={notify} />
        </View>
      ) : (
        <TouchableOpacity
          accessibilityRole='button'
          accessibilityLabel='Connect Spotify'
          disabled={SpotifyConnectionState.$is('Connecting')(connection)}
          onPress={() => void connect()}
          style={{
            backgroundColor: SPOTIFY_GREEN,
            borderRadius: 4,
            paddingVertical: 14,
            alignItems: 'center',
            opacity: SpotifyConnectionState.$is('Connecting')(connection) ? 0.6 : 1,
          }}>
          <Text style={{ color: '#000', fontSize: 15, fontWeight: '700' }}>
            {SpotifyConnectionState.$is('Connecting')(connection)
              ? 'Connecting...'
              : 'Connect Spotify'}
          </Text>
        </TouchableOpacity>
      )}

      {'error' in connection && connection.error ? (
        <Text style={{ color: colors.error, fontSize: 13, marginTop: 8 }}>{connection.error}</Text>
      ) : null}

      <SpotifyToast notice={notice} />
    </View>
  )
}
