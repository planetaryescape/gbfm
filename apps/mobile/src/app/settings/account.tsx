import { Stack, useRouter } from 'expo-router'

import { openSettingsLink } from '@/components/Profile/openSettingsLink'
import { SettingsScreen } from '@/components/Profile/SettingsScreen'
import { SettingsRow, SettingsSection } from '@/components/Profile/SettingsSection'
import { SignOutSection } from '@/components/Profile/SignOutSection'
import { useAuthStore } from '@/store/auth'

export default function AccountSettings() {
  const user = useAuthStore((state) => state.user)
  const router = useRouter()

  return (
    <>
      <Stack.Screen options={{ title: 'Account' }} />
      <SettingsScreen>
        <SettingsSection title='Account details'>
          {user ? (
            <>
              <SettingsRow
                title={user.name}
                detail={
                  user.username
                    ? `@${user.username} · ${user.role ?? 'user'}`
                    : (user.role ?? 'user')
                }
              />
              <SettingsRow
                title={user.email}
                detail={user.verified ? 'Email verified' : 'Email not verified'}
              />
              {user.username ? (
                <SettingsRow
                  title='View public profile'
                  onPress={() =>
                    openSettingsLink(
                      `https://goosebumps.fm/profile/${encodeURIComponent(user.username ?? '')}`,
                    )
                  }
                />
              ) : null}
            </>
          ) : (
            <SettingsRow
              title='Sign in'
              detail='Access your account and writing tools.'
              onPress={() => router.push('/sign-in')}
            />
          )}
        </SettingsSection>
        {user ? <SignOutSection /> : null}
      </SettingsScreen>
    </>
  )
}
