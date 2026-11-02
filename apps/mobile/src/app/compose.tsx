import { ActivityIndicator } from 'react-native'

import { TweetComposer } from '@/components/Tweets/TweetComposer'
import { useAuthReady, useAuthStore } from '@/store/auth'

export default function ComposeScreen() {
  const ready = useAuthReady()
  const identity = useAuthStore((state) => state.user?.id ?? 'guest')

  return ready ? <TweetComposer key={identity} identity={identity} /> : <ActivityIndicator />
}
