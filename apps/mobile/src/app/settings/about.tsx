import Constants from 'expo-constants'
import { Stack } from 'expo-router'

import { openSettingsLink } from '@/components/Profile/openSettingsLink'
import { SettingsScreen } from '@/components/Profile/SettingsScreen'
import { SettingsRow, SettingsSection } from '@/components/Profile/SettingsSection'

export default function AboutSettings() {
  return (
    <>
      <Stack.Screen options={{ title: 'About & help' }} />
      <SettingsScreen>
        <SettingsSection title='Sharing to the app'>
          <SettingsRow
            title='Share into Goosebumps FM'
            detail='In another app, tap Share, then choose gbfm. Use More to add it to your favourites. Text and links open in your draft, never publish automatically.'
          />
        </SettingsSection>
        <SettingsSection title='Goosebumps FM'>
          <SettingsRow
            title='Version'
            detail={`${Constants.expoConfig?.version ?? '1.0.0'} · ${Constants.nativeBuildVersion ?? 'development'}`}
          />
          <SettingsRow
            title='Visit Goosebumps FM'
            onPress={() => openSettingsLink('https://goosebumps.fm')}
          />
        </SettingsSection>
        <SettingsSection title='Legal'>
          <SettingsRow
            title='Privacy policy'
            onPress={() => openSettingsLink('https://goosebumps.fm/privacy')}
          />
          <SettingsRow
            title='Terms of use'
            onPress={() => openSettingsLink('https://goosebumps.fm/terms')}
          />
        </SettingsSection>
      </SettingsScreen>
    </>
  )
}
