import { useLocalSearchParams } from 'expo-router'
import { ActivityIndicator } from 'react-native'

import { TweetComposer } from '@/components/Tweets/TweetComposer'
import { useAuthReady, useAuthStore } from '@/store/auth'

export default function ComposeScreen() {
  const ready = useAuthReady()
  const identity = useAuthStore((state) => state.user?.id ?? 'guest')
  const { edit, reply } = useLocalSearchParams<{ edit?: string; reply?: string }>()
  const editSlug = edit ?? null
  const replyTo = editSlug ? null : (reply ?? null)

  return ready ? (
    <TweetComposer
      key={`${identity}:${editSlug ?? 'new'}:${replyTo ?? 'post'}`}
      identity={identity}
      editSlug={editSlug}
      replyTo={replyTo}
    />
  ) : (
    <ActivityIndicator />
  )
}
