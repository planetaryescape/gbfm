import { Effect } from 'effect'
import { randomUUID } from 'expo-crypto'
import { useFocusEffect, useRouter } from 'expo-router'
import { clearSharedPayloads, getSharedPayloads } from 'expo-sharing'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'

import { Screen } from '@/components/Screen'
import { ComposerButton } from '@/components/Tweets/ComposerButton'
import { useAuthReady, useAuthStore } from '@/store/auth'
import { useThemeColors } from '@/theme/colors'
import {
  appendSharedText,
  CONTENT_MAX_LENGTH,
  emptyTweetDraft,
  parseSharedText,
  SharedContentInvalid,
} from '@/tweets/draft'
import { restoreTweetDraft, saveTweetDraft } from '@/tweets/draftStorage'

const receiveSharedDraft = (identity: string) =>
  Effect.gen(function* () {
    const payloads = yield* Effect.try({
      try: getSharedPayloads,
      catch: () =>
        new SharedContentInvalid({
          message: 'Could not read this share. Return to the source app and share again.',
        }),
    })

    const text = yield* parseSharedText(payloads)
    const stored = yield* restoreTweetDraft(identity)
    const draft = appendSharedText(stored ?? emptyTweetDraft(randomUUID()), text)

    if (draft.content.length > CONTENT_MAX_LENGTH)
      return yield* new SharedContentInvalid({
        message:
          'Your existing draft and this share are too long together. Finish your draft first, then share again.',
      })
    yield* saveTweetDraft(identity, draft)
    yield* Effect.try({
      try: clearSharedPayloads,
      catch: () =>
        new SharedContentInvalid({
          message: 'The share was saved to your draft. Open the draft to continue.',
        }),
    })

    return undefined
  })

export default function IncomingShareScreen() {
  const ready = useAuthReady()
  const identity = useAuthStore((state) => state.user?.id ?? 'guest')
  const [error, setError] = useState<string | null>(null)
  const colors = useThemeColors()
  const router = useRouter()

  const receive = useCallback(() => {
    if (!ready) return
    Effect.runSync(
      receiveSharedDraft(identity).pipe(
        Effect.match({
          onSuccess: () => router.replace('/compose'),
          onFailure: (cause) => setError(cause.message),
        }),
      ),
    )
  }, [ready, identity, router])

  useFocusEffect(receive)

  return (
    <Screen>
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
        {error ? (
          <>
            <Text accessibilityRole='alert' style={{ color: colors.error }}>
              {error}
            </Text>
            <ComposerButton label='Open tweet draft' onPress={() => router.replace('/compose')} />
            <ComposerButton label='Try again' onPress={receive} />
          </>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
    </Screen>
  )
}
