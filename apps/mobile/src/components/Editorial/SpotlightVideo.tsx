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
    <SquareFrame title='YouTube'>
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
              width: 54,
              height: 54,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.strong,
              backgroundColor: colors.surface,
            }}>
            <Text style={{ color: colors.strong, fontSize: 22, marginLeft: 4 }}>▶</Text>
          </View>
        </ImageBackground>
        <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}>
          <Text style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 14 }}>
            {title}
          </Text>
        </View>
      </Pressable>
    </SquareFrame>
  )
}
