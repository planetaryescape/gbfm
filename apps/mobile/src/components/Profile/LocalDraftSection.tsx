import { Effect } from 'effect'
import { useState } from 'react'
import { Alert, Text, View } from 'react-native'

import { useAuthStore } from '@/store/auth'
import { useThemeColors } from '@/theme/colors'
import { removeTweetDraft } from '@/tweets/draftStorage'

import { SettingsRow, SettingsSection } from './SettingsSection'

export function LocalDraftSection() {
  const user = useAuthStore((state) => state.user)
  const colors = useThemeColors()
  const [notice, setNotice] = useState<string | null>(null)

  const discard = () =>
    Alert.alert(
      'Discard local tweet draft?',
      'This cannot be undone. Published tweets and account drafts will not change.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () =>
            Effect.runSync(
              removeTweetDraft(user?.id ?? 'guest').pipe(
                Effect.match({
                  onSuccess: () => setNotice('Local tweet draft removed.'),
                  onFailure: () => setNotice('Could not remove the local draft. Please try again.'),
                }),
              ),
            ),
        },
      ],
    )

  return (
    <View style={{ gap: 12 }}>
      <SettingsSection title='On this device'>
        <SettingsRow
          title='Discard local tweet draft'
          detail='Only removes the draft for the current account on this phone. Account drafts are kept.'
          destructive
          onPress={discard}
        />
      </SettingsSection>
      {notice ? (
        <Text accessibilityLiveRegion='polite' style={{ color: colors.text }}>
          {notice}
        </Text>
      ) : null}
    </View>
  )
}
