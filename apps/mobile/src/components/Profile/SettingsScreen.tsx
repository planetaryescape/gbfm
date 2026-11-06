import type { PropsWithChildren } from 'react'
import { ScrollView } from 'react-native'

import { Screen } from '@/components/Screen'

export function SettingsScreen({
  children,
  topInset = false,
}: PropsWithChildren<{ readonly topInset?: boolean }>) {
  return (
    <Screen topInset={topInset}>
      <ScrollView
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 28 }}>
        {children}
      </ScrollView>
    </Screen>
  )
}
