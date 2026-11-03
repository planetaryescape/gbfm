import { useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-screens/experimental'

import { RepliesSheet } from '@/components/Tweets/RepliesSheet'

export default function RepliesScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()

  return (
    <SafeAreaView edges={{ bottom: true, top: false, left: true, right: true }} style={{ flex: 1 }}>
      <RepliesSheet slug={slug} />
    </SafeAreaView>
  )
}
