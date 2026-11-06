import { Stack, useRouter } from 'expo-router'

import { LocalDraftSection } from '@/components/Profile/LocalDraftSection'
import { SettingsScreen } from '@/components/Profile/SettingsScreen'
import { SettingsRow, SettingsSection } from '@/components/Profile/SettingsSection'

export default function Writing() {
  const router = useRouter()

  return (
    <>
      <Stack.Screen options={{ title: 'Writing & drafts' }} />
      <SettingsScreen>
        <SettingsSection title='Writing'>
          <SettingsRow
            title='Write a tweet'
            detail='Start writing or pick up your saved local draft.'
            onPress={() => router.push('/compose')}
          />
        </SettingsSection>
        <LocalDraftSection />
      </SettingsScreen>
    </>
  )
}
