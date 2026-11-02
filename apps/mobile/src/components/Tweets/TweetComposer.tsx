import { canCreatePosts } from '@gbfm/core/roles'
import { Stack, useRouter } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-screens/experimental'

import { useAuthStore } from '@/store/auth'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { draftError, TWEET_MAX_LENGTH } from '@/tweets/draft'
import { useTweetComposer } from '@/tweets/useTweetComposer'

import { ComposerButton } from './ComposerButton'
import { ComposerField } from './ComposerField'

export function TweetComposer({ identity }: { readonly identity: string }) {
  const { user, sessionToken } = useAuthStore((state) => state)
  const composer = useTweetComposer(identity, sessionToken)
  const { draft, busy } = composer
  const [musicUrl, setMusicUrl] = useState('')
  const colors = useThemeColors()
  const router = useRouter()
  const headerHeight = useHeaderHeight()
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/(tweets)'))
  const allowed = canCreatePosts(user?.role)

  const published = (slug: string) =>
    router.replace({ pathname: '/(tabs)/(tweets)/tweet/[slug]', params: { slug } })

  const validation = draft ? draftError(draft) : null

  return (
    <SafeAreaView
      edges={{ bottom: true, top: false, left: true, right: true }}
      style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          headerBackVisible: false,
          headerLeft: () => (
            <ComposerButton
              label='Close'
              disabled={busy}
              onPress={() => {
                if (!draft || composer.change(draft)) close()
              }}
            />
          ),
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}
        style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps='handled'
          keyboardDismissMode='on-drag'
          contentContainerStyle={{ padding: 20, gap: 22 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.accent, fontFamily: fonts.serif, fontSize: 32 }}>
              Put it into words.
            </Text>
            <Text
              style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12, lineHeight: 19 }}>
              Saved on this phone as you write. Nothing goes public until you choose Publish.
            </Text>
          </View>
          {composer.error ? (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole='alert' style={{ color: colors.error }}>
                {composer.error}
              </Text>
              {!draft ? (
                <ComposerButton label='Retry restoring draft' onPress={composer.restore} />
              ) : null}
            </View>
          ) : null}
          {draft ? (
            <>
              <ComposerField
                label='Tweet'
                value={draft.title}
                onChangeText={(title) => composer.change({ ...draft, title })}
                multiline
                editable={!busy}
                placeholder='What are you listening to?'
                hint={`${draft.title.length}/${TWEET_MAX_LENGTH} characters`}
              />
              <ComposerField
                label='Body (optional)'
                value={draft.content}
                onChangeText={(content) => composer.change({ ...draft, content })}
                multiline
                editable={!busy}
                placeholder='More to say? Add text, links or Markdown here.'
                hint='Shared links and longer selections appear here.'
              />
              <ComposerField
                label='Tags (optional)'
                value={draft.tags}
                onChangeText={(tags) => composer.change({ ...draft, tags })}
                editable={!busy}
                placeholder='jazz, new music'
                hint='Separate tags with commas.'
              />
              {sessionToken && allowed ? (
                <View style={{ gap: 10 }}>
                  {draft.music ? (
                    <View style={{ gap: 8 }}>
                      <Text style={{ color: colors.text }}>
                        {draft.music.entityType}: {draft.music.title}
                      </Text>
                      <ComposerButton
                        label='Remove music attachment'
                        disabled={busy}
                        onPress={() => composer.change({ ...draft, music: null })}
                      />
                    </View>
                  ) : (
                    <>
                      <ComposerField
                        label='Music link (optional)'
                        value={musicUrl}
                        onChangeText={setMusicUrl}
                        editable={!busy}
                        autoCapitalize='none'
                        autoCorrect={false}
                        keyboardType='url'
                        placeholder='Paste an album, track or playlist link'
                      />
                      <ComposerButton
                        label='Attach music'
                        disabled={busy || !musicUrl.trim()}
                        onPress={() => composer.attachMusic(musicUrl)}
                      />
                    </>
                  )}
                </View>
              ) : null}
              {validation ? (
                <Text style={{ color: colors.muted, fontSize: 13 }}>{validation}</Text>
              ) : null}
              {composer.notice ? (
                <Text accessibilityLiveRegion='polite' style={{ color: colors.success }}>
                  {composer.notice}
                </Text>
              ) : null}
              {busy ? <ActivityIndicator color={colors.accent} /> : null}
              {!user ? (
                <ComposerButton
                  label='Sign in to publish'
                  onPress={() => router.push('/sign-in')}
                />
              ) : !allowed ? (
                <Text style={{ color: colors.muted, lineHeight: 22 }}>
                  Your draft is saved on this phone. Publishing requires a creator account.
                </Text>
              ) : (
                <View style={{ gap: 12 }}>
                  <ComposerButton
                    label='Publish'
                    primary
                    disabled={busy || validation !== null}
                    onPress={() =>
                      Alert.alert(
                        'Publish this tweet?',
                        'It will be visible to everyone on Goosebumps FM.',
                        [
                          { text: 'Keep writing', style: 'cancel' },
                          { text: 'Publish', onPress: () => composer.save(true, published) },
                        ],
                      )
                    }
                  />
                  <ComposerButton
                    label='Save private draft to account'
                    disabled={busy || validation !== null}
                    onPress={() => composer.save(false, published)}
                  />
                </View>
              )}
              <ComposerButton
                label='Discard local draft'
                destructive
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    'Discard this local draft?',
                    draft.remote
                      ? 'The private draft saved to your account will remain there.'
                      : 'This cannot be undone.',
                    [
                      { text: 'Keep writing', style: 'cancel' },
                      {
                        text: 'Discard',
                        style: 'destructive',
                        onPress: () => composer.discard(close),
                      },
                    ],
                  )
                }
              />
            </>
          ) : !composer.error ? (
            <ActivityIndicator color={colors.accent} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
