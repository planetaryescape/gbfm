import { Stack } from 'expo-router'

import { AppearanceSection } from '@/components/Profile/AppearanceSection'
import { SettingsScreen } from '@/components/Profile/SettingsScreen'

export default function AppearanceSettings() {
  return (
    <>
      <Stack.Screen options={{ title: 'Appearance' }} />
      <SettingsScreen>
        <AppearanceSection />
      </SettingsScreen>
    </>
  )
}
