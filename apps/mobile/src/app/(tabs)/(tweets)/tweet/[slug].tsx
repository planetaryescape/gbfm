import { useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-screens/experimental'

import { TweetReader } from '@/components/Tweets/TweetReader'

export default function TweetScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()

  return (
    <SafeAreaView edges={{ bottom: true, left: true, right: true, top: false }} style={{ flex: 1 }}>
      <TweetReader initialSlug={slug} />
    </SafeAreaView>
  )
}
