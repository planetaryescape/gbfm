import { ImageBackground, Linking, Pressable, Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { SquareFrame } from './SquareFrame'

type Props = {
  readonly id: string
  readonly title: string
  readonly url: string
}

export function SpotlightVideo({ id, title, url }: Props) {
  const colors = useThemeColors()

  return (
    <SquareFrame background='#000'>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`Play video on YouTube: ${title}`}
        onPress={() => void Linking.openURL(url)}>
        <ImageBackground
          source={{ uri: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` }}
          defaultSource={{ uri: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }}
          resizeMode='cover'
          style={{ aspectRatio: 16 / 9, justifyContent: 'center', alignItems: 'center' }}>
          <View
            style={{
              width: 60,
              height: 60,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: '#000',
              backgroundColor: '#fff',
            }}>
            <Text style={{ color: '#000', fontSize: 24, marginLeft: 4 }}>▶</Text>
          </View>
        </ImageBackground>
        <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}>
          <Text
            style={{
              color: colors.accent,
              fontFamily: fonts.monoSemiBold,
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
            }}>
            YouTube
          </Text>
          <Text style={{ color: '#fff', fontFamily: fonts.monoSemiBold, fontSize: 14 }}>
            {title}
          </Text>
        </View>
      </Pressable>
    </SquareFrame>
  )
}
