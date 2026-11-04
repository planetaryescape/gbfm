import { canCreatePosts } from '@gbfm/core/roles'
import { useRouter } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { type ComponentRef, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-screens/experimental'

import { haptics } from '@/feedback/haptics'
import { useAuthStore } from '@/store/auth'
import { useThemeColors } from '@/theme/colors'
import { composerControls } from '@/tweets/composerOwner'
import { draftError, replyError, tweetLength } from '@/tweets/draft'
import { completions } from '@/tweets/tagSuggestions'
import { useComposerRemoval } from '@/tweets/useComposerRemoval'
import { useKnownTags } from '@/tweets/useKnownTags'
import { useTweetComposer } from '@/tweets/useTweetComposer'

import { ComposerButton } from './ComposerButton'
import { ComposerFooter } from './ComposerFooter'
import { ComposerHeader } from './ComposerHeader'
import { ComposerInput } from './ComposerInput'
import { ComposerMusicPreview } from './ComposerMusicPreview'
import { ComposerRecovery } from './ComposerRecovery'
import { ComposerTagSuggestions } from './ComposerTagSuggestions'

export function TweetComposer({
  identity,
  editSlug,
  replyTo,
}: {
  readonly identity: string
  readonly editSlug: string | null
  readonly replyTo: string | null
}) {
  const { user, sessionToken } = useAuthStore((state) => state)
  const creator = canCreatePosts(user?.role)
  const allowed = replyTo ? Boolean(user) : creator
  const knownTags = useKnownTags()

  const composer = useTweetComposer({
    identity,
    sessionToken,
    resolvesMusic: creator,
    editSlug,
    replyTo,
    knownTags,
  })

  const { draft, busy, editing, replying } = composer
  const colors = useThemeColors()
  const router = useRouter()
  const { leave, requestRemoval } = useComposerRemoval(composer.publication)
  const headerHeight = useHeaderHeight()
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  const [cursor, setCursor] = useState(0)
  const tags = completions(replying ? '' : (draft?.text ?? ''), cursor, knownTags)

  const pickTag = (tag: string) => {
    const next = tags.complete(tag)

    if (!next) return
    void haptics.select()
    composer.setText(next.text)
    setCursor(next.cursor)
    requestAnimationFrame(() => input.current?.setSelection(next.cursor, next.cursor))
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/(tweets)'))

  const published = (slug: string) => {
    void haptics.success()

    leave(() => {
      if (editing || replying) close()
      else router.replace({ pathname: '/(tabs)/(tweets)/tweet/[slug]', params: { slug } })
    })
  }

  const validation = draft ? (replying ? replyError(draft) : draftError(draft)) : null
  const canSave = Boolean(!editing && !replying && user && allowed && draft?.text.trim())

  const controls = composerControls(composer.publication, {
    canSubmit: Boolean(allowed && draft && validation === null && !composer.musicLoading),
    canSave,
    label: editing ? 'Save' : replying ? 'Reply' : 'Post',
  })

  const cancel = () => {
    if (!controls.editable) {
      requestRemoval(close)

      return
    }

    if (!draft || !draft.text.trim()) {
      composer.discard(close)

      return
    }

    if (editing) {
      Alert.alert('Discard your changes?', 'The published tweet stays as it was.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => composer.discard(close) },
      ])

      return
    }

    Alert.alert('Keep this draft?', 'It stays on this phone until you post or delete it.', [
      { text: 'Keep writing', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => composer.discard(close) },
      {
        text: 'Keep draft',
        onPress: () => {
          if (composer.change(draft)) close()
        },
      },
    ])
  }

  const status = composer.error
    ? { tone: 'error' as const, text: composer.error }
    : composer.notice
      ? { tone: 'success' as const, text: composer.notice }
      : user && !allowed
        ? { tone: 'muted' as const, text: 'Posting needs a creator account. Your draft is saved.' }
        : null

  return (
    <SafeAreaView
      edges={{ bottom: true, top: false, left: true, right: true }}
      style={{ flex: 1, backgroundColor: colors.background }}>
      <ComposerHeader
        signedIn={Boolean(user) || controls.cleanupPending || controls.requiresThreadCheck}
        busy={busy}
        label={controls.label}
        busyLabel={controls.busyLabel}
        disabled={!controls.canSubmit}
        onCancel={cancel}
        onSubmit={() => {
          const recoveryTarget = replyTo ?? draft?.slug

          if (controls.requiresThreadCheck && recoveryTarget) {
            leave(() =>
              router.replace({
                pathname: '/(tabs)/(tweets)/tweet/[slug]',
                params: { slug: recoveryTarget },
              }),
            )

            return
          }

          composer.save(true, published)
        }}
        onSignIn={() => router.push('/sign-in')}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}
        style={{ flex: 1 }}>
        {draft ? (
          <>
            <ScrollView
              keyboardShouldPersistTaps='handled'
              contentContainerStyle={{ padding: 16, gap: 16 }}>
              <ComposerInput
                ref={input}
                text={draft.text}
                editable={!busy && controls.editable}
                placeholder={replying ? 'Post your reply' : 'What are you listening to?'}
                onChangeText={composer.setText}
                onCursorChange={setCursor}
              />
              {controls.editable ? (
                <ComposerTagSuggestions suggestions={tags.suggestions} onPick={pickTag} />
              ) : null}
              <ComposerMusicPreview
                music={draft.music}
                loading={controls.editable && composer.musicLoading}
                onDismiss={controls.editable ? composer.dismissMusic : undefined}
              />
              <ComposerRecovery
                publication={composer.publication}
                busy={busy}
                onRecover={composer.recover}
              />
            </ScrollView>
            <ComposerFooter
              length={tweetLength(draft.text)}
              status={status}
              saveLabel={controls.canSave ? 'Save to drafts' : null}
              onSave={() => composer.save(false, published)}
            />
          </>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            {composer.error ? (
              <>
                <ComposerFooter length={0} status={status} saveLabel={null} onSave={close} />
                <ComposerButton label='Retry' onPress={composer.retry} />
                <ComposerRecovery
                  publication={composer.publication}
                  busy={busy}
                  onRecover={composer.recover}
                />
              </>
            ) : (
              <ActivityIndicator color={colors.accent} />
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
