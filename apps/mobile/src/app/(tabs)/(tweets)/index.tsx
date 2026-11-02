import { useRouter } from 'expo-router'
import { View } from 'react-native'

import { Screen } from '@/components/Screen'
import { ComposerButton } from '@/components/Tweets/ComposerButton'
import { TweetReader } from '@/components/Tweets/TweetReader'

export default function Tweets() {
  const router = useRouter()

  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingVertical: 6, alignItems: 'flex-end' }}>
        <ComposerButton label='Write a tweet' onPress={() => router.push('/compose')} />
      </View>
      <TweetReader />
    </Screen>
  )
}
