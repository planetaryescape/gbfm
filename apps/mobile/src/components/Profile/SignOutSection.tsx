import { Effect } from 'effect'
import { Alert } from 'react-native'

import { useClearAuth } from '@/store/auth'

import { SettingsRow, SettingsSection } from './SettingsSection'

export function SignOutSection() {
  const clearAuth = useClearAuth()

  const signOut = () =>
    Alert.alert(
      'Sign out?',
      'Your account draft stays on this phone. You can access it when you sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            void Effect.runPromise(
              clearAuth().pipe(
                Effect.catch(() =>
                  Effect.sync(() =>
                    Alert.alert(
                      'Could not finish signing out',
                      'The saved session could not be removed. Please try again.',
                    ),
                  ),
                ),
              ),
            )
          },
        },
      ],
    )

  return (
    <SettingsSection title='Session'>
      <SettingsRow title='Sign out' destructive onPress={signOut} />
    </SettingsSection>
  )
}
