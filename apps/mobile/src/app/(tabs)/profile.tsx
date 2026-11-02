import { Effect } from 'effect'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, Linking, ScrollView, Text, View } from 'react-native'

import { AppearanceSection } from '@/components/Profile/AppearanceSection'
import { SettingsRow, SettingsSection } from '@/components/Profile/SettingsSection'
import { SpotifySection } from '@/components/Profile/SpotifySection'
import { Screen } from '@/components/Screen'
import { useAuthStore, useClearAuth } from '@/store/auth'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { removeTweetDraft } from '@/tweets/draftStorage'

export default function Profile() {
  const user = useAuthStore((state) => state.user)
  const router = useRouter()
  const clearAuth = useClearAuth()
  const colors = useThemeColors()
  const [notice, setNotice] = useState<string | null>(null)

  const open = (url: string) => {
    void Linking.openURL(url).catch(() => Alert.alert('Could not open link', 'Please try again.'))
  }

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
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 28 }}>
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.accent, fontFamily: fonts.serif, fontSize: 38 }}>
            Settings
          </Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
            Make yourself at home.
          </Text>
        </View>
        <SettingsSection title='Account'>
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
                    open(`https://goosebumps.fm/profile/${encodeURIComponent(user.username ?? '')}`)
                  }
                />
              ) : null}
            </>
          ) : (
            <SettingsRow
              title='Sign in'
              detail='Publish tweets and manage your music reminders.'
              onPress={() => router.push('/sign-in')}
            />
          )}
        </SettingsSection>
        <AppearanceSection />
        <SettingsSection title='Writing & listening'>
          <SettingsRow
            title='Write a tweet'
            detail='Start writing or pick up your saved local draft.'
            onPress={() => router.push('/compose')}
          />
          <SettingsRow
            title='Share into Goosebumps FM'
            detail='In another app, tap Share, then choose gbfm. Use More to add it to your favourites. Text and links open in your draft, never publish automatically.'
          />
          {user ? (
            <SettingsRow
              title='Music reminders'
              detail='Manage what you want to listen to next.'
              onPress={() => router.push('/music-reminders')}
            />
          ) : null}
        </SettingsSection>
        <SpotifySection />
        <SettingsSection title='On this device'>
          <SettingsRow
            title='Discard local tweet draft'
            detail='Only removes the draft for the current account on this phone. Account drafts are kept.'
            destructive
            onPress={() =>
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
                            onFailure: () =>
                              setNotice('Could not remove the local draft. Please try again.'),
                          }),
                        ),
                      ),
                  },
                ],
              )
            }
          />
        </SettingsSection>
        {notice ? (
          <Text accessibilityLiveRegion='polite' style={{ color: colors.text }}>
            {notice}
          </Text>
        ) : null}
        <SettingsSection title='About'>
          <SettingsRow
            title='Goosebumps FM'
            detail={`Version ${Constants.expoConfig?.version ?? '1.0.0'} · ${Constants.nativeBuildVersion ?? 'development'}`}
          />
          <SettingsRow
            title='Privacy policy'
            onPress={() => open('https://goosebumps.fm/privacy')}
          />
          <SettingsRow title='Terms of use' onPress={() => open('https://goosebumps.fm/terms')} />
          <SettingsRow title='Visit Goosebumps FM' onPress={() => open('https://goosebumps.fm')} />
        </SettingsSection>
        {user ? (
          <SettingsSection title='Session'>
            <SettingsRow title='Sign out' destructive onPress={signOut} />
          </SettingsSection>
        ) : null}
      </ScrollView>
    </Screen>
  )
}
