import { useRouter } from 'expo-router'
import { Text, View } from 'react-native'

import { SettingsScreen } from '@/components/Profile/SettingsScreen'
import { SettingsRow, SettingsSection } from '@/components/Profile/SettingsSection'
import { SpotifyConnectionState, useSpotifyConnection } from '@/spotify/connection'
import { useAuthStore } from '@/store/auth'
import { useColorSchemePreference } from '@/store/preferences'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

const appearanceLabels = { system: 'System', light: 'Light', dark: 'Dark' }

export default function Profile() {
  const user = useAuthStore((state) => state.user)
  const preference = useColorSchemePreference()
  const connection = useSpotifyConnection((state) => state)
  const router = useRouter()
  const colors = useThemeColors()

  const spotifyStatus = SpotifyConnectionState.$match(connection, {
    Bootstrapping: () => 'Checking…',
    Connecting: () => 'Connecting…',
    Connected: () => 'Connected',
    Disconnected: () => 'Not connected',
  })

  return (
    <SettingsScreen topInset>
      <View style={{ gap: 8 }}>
        <Text
          accessibilityRole='header'
          maxFontSizeMultiplier={1.5}
          style={{ color: colors.accent, fontFamily: fonts.serif, fontSize: 34 }}>
          Settings
        </Text>
        <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>
          Your account, preferences and connected apps.
        </Text>
      </View>
      <SettingsSection title='Account'>
        {user ? (
          <SettingsRow
            title={user.name}
            detail={user.username ? `@${user.username}` : 'Account details and sign out'}
            onPress={() => router.push('/settings/account')}
          />
        ) : (
          <SettingsRow
            title='Sign in'
            detail='Access your account and writing tools.'
            onPress={() => router.push('/sign-in')}
          />
        )}
      </SettingsSection>
      <SettingsSection title='Preferences'>
        <SettingsRow
          title='Appearance'
          value={appearanceLabels[preference]}
          onPress={() => router.push('/settings/appearance')}
        />
      </SettingsSection>
      <SettingsSection title='Connections'>
        <SettingsRow
          title='Spotify'
          value={spotifyStatus}
          onPress={() => router.push('/settings/spotify')}
        />
      </SettingsSection>
      <SettingsSection title='More'>
        <SettingsRow title='Writing & drafts' onPress={() => router.push('/settings/writing')} />
        {user ? (
          <SettingsRow title='Music reminders' onPress={() => router.push('/music-reminders')} />
        ) : null}
        <SettingsRow title='About & help' onPress={() => router.push('/settings/about')} />
      </SettingsSection>
    </SettingsScreen>
  )
}
