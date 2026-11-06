import { Stack } from 'expo-router'
import { Text, View } from 'react-native'

import { Button } from '@/components/Button'
import { openSettingsLink } from '@/components/Profile/openSettingsLink'
import { SettingsScreen } from '@/components/Profile/SettingsScreen'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export default function MusicReminders() {
  const colors = useThemeColors()

  return (
    <>
      <Stack.Screen options={{ title: 'Music reminders' }} />
      <SettingsScreen>
        <View style={{ gap: 12 }}>
          <Text
            accessibilityRole='header'
            style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 20 }}>
            Your music reminders
          </Text>
          <Text
            style={{ color: colors.text, fontFamily: fonts.mono, fontSize: 14, lineHeight: 22 }}>
            View and manage your reminders on the website. Sign in with your Goosebumps FM account.
          </Text>
          <Button
            label='Open reminders on web'
            role='link'
            onPress={() => openSettingsLink('https://goosebumps.fm/reminders')}
          />
        </View>
      </SettingsScreen>
    </>
  )
}
