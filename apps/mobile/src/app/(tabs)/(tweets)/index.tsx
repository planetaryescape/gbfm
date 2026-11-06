import { useRouter } from 'expo-router'
import { Text, useWindowDimensions, View } from 'react-native'

import { Button } from '@/components/Button'
import { Screen } from '@/components/Screen'
import { TweetPager } from '@/components/Tweets/TweetPager'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export default function Tweets() {
  const router = useRouter()
  const colors = useThemeColors()
  const { fontScale } = useWindowDimensions()

  return (
    <Screen topInset>
      <View
        style={{
          flexDirection: fontScale >= 1.5 ? 'column' : 'row',
          alignItems: fontScale >= 1.5 ? 'stretch' : 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingBottom: 8,
          gap: 8,
        }}>
        <Text
          maxFontSizeMultiplier={1.5}
          style={{ color: colors.accent, fontFamily: fonts.monoSemiBold, fontSize: 20 }}>
          Tweets
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          <Button label='Drafts' variant='quiet' onPress={() => router.push('/writing')} />
          <Button label='Write' onPress={() => router.push('/compose')} />
        </View>
      </View>
      <TweetPager />
    </Screen>
  )
}
