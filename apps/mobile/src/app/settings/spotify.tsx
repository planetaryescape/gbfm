import { Stack } from 'expo-router'

import { SettingsScreen } from '@/components/Profile/SettingsScreen'
import { SpotifySection } from '@/components/Profile/SpotifySection'

export default function SpotifySettings() {
  return (
    <>
      <Stack.Screen options={{ title: 'Spotify' }} />
      <SettingsScreen>
        <SpotifySection />
      </SettingsScreen>
    </>
  )
}
