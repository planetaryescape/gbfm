import { radii } from '@gbfm/theme'
import { ImageBackground, Pressable, Text, View } from 'react-native'

import { useNowPlaying } from '@/audio/NowPlayingProvider'
import { useVideoSession } from '@/editorial/useVideoSession'
import { Glyph } from '@/icons/Glyph'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { VideoSheet } from './VideoSheet'

type Props = {
  readonly id: string
  readonly title: string
  readonly canonicalUrl: string
}

export function SpotlightVideo({ id, title, canonicalUrl }: Props) {
  const colors = useThemeColors()
  const { pauseForExternalAudio } = useNowPlaying()
  const session = useVideoSession(pauseForExternalAudio)

  return (
    <>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`Play video: ${title}`}
        onPress={() => void session.open()}
        style={{
          overflow: 'hidden',
          borderWidth: 1,
          borderRadius: radii.surface,
          borderColor: `${colors.muted}40`,
          backgroundColor: '#000',
        }}>
        <ImageBackground
          source={{ uri: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` }}
          defaultSource={{ uri: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }}
          resizeMode='cover'
          style={{ aspectRatio: 16 / 9, justifyContent: 'flex-end' }}>
          <View
            style={{
              position: 'absolute',
              alignSelf: 'center',
              top: '50%',
              marginTop: -26,
              width: 52,
              height: 52,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radii.round,
              backgroundColor: colors.surface,
            }}>
            <Glyph name='play' size={22} color={colors.strong} />
          </View>
          <View style={{ gap: 2, padding: 12, backgroundColor: 'rgba(0,0,0,0.6)' }}>
            <Text style={{ color: '#fff', opacity: 0.75, fontFamily: fonts.mono, fontSize: 10 }}>
              YouTube
            </Text>
            <Text
              numberOfLines={2}
              style={{ color: '#fff', fontFamily: fonts.monoSemiBold, fontSize: 13 }}>
              {title}
            </Text>
          </View>
        </ImageBackground>
      </Pressable>
      {session.failed ? (
        <Text accessibilityLiveRegion='polite'>Could not pause audio. Tap to retry.</Text>
      ) : null}
      <VideoSheet
        id={id}
        title={title}
        canonicalUrl={canonicalUrl}
        visible={session.visible}
        onClose={session.close}
      />
    </>
  )
}
