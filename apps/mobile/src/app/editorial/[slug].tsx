import { Stack, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-screens/experimental'

import { SpotlightReader } from '@/components/Editorial/SpotlightReader'

export default function EditorialScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()

  return (
    <SafeAreaView
      collapsable={false}
      edges={{ bottom: true, left: true, right: true, top: false }}
      style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Editorial' }} />
      <SpotlightReader slug={slug} />
    </SafeAreaView>
  )
}
