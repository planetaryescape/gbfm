import { useRouter } from 'expo-router'
import { View } from 'react-native'

import { Screen } from '@/components/Screen'
import { ComposeFab } from '@/components/Tweets/ComposeFab'
import { TweetPager } from '@/components/Tweets/TweetPager'

export default function Tweets() {
  const router = useRouter()

  return (
    <Screen topInset>
      <View style={{ flex: 1 }}>
        <TweetPager />
        <ComposeFab onPress={() => router.push('/compose')} />
      </View>
    </Screen>
  )
}
