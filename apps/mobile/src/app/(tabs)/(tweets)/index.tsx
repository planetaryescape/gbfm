import { useRouter } from 'expo-router'
import { Text, View } from 'react-native'

import { Screen } from '@/components/Screen'
import { ComposeFab } from '@/components/Tweets/ComposeFab'
import { TweetPager } from '@/components/Tweets/TweetPager'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export default function Tweets() {
  const router = useRouter()
  const colors = useThemeColors()

  return (
    <Screen topInset>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text
          accessibilityRole='header'
          maxFontSizeMultiplier={1.5}
          style={{ color: colors.accent, fontFamily: fonts.monoSemiBold, fontSize: 20 }}>
          Tweets
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <TweetPager />
        <ComposeFab onPress={() => router.push('/compose')} />
      </View>
    </Screen>
  )
}
