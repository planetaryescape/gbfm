import { brandDark, radii } from '@gbfm/theme'
import { useRouter } from 'expo-router'
import { NativeTabs } from 'expo-router/native-tabs'
import {
  ActivityIndicator,
  DynamicColorIOS as dynamicColorIOS,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native'

import { useNowPlaying } from '@/audio/NowPlayingProvider'
import { Glyph } from '@/icons/Glyph'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

const textColor =
  Platform.OS === 'ios'
    ? dynamicColorIOS({ dark: brandDark.overlayText, light: brandDark.bg })
    : brandDark.overlayText

function Artwork({
  url,
  size,
  colors,
}: {
  url: string | null | undefined
  size: number
  colors: ReturnType<typeof useThemeColors>
}) {
  if (!url) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radii.artwork,
          backgroundColor: colors.accentSurface,
        }}
      />
    )
  }

  return (
    <Image
      source={{ uri: url }}
      style={{ width: size, height: size, borderRadius: radii.artwork }}
      resizeMode='cover'
    />
  )
}

export function MiniPlayerBar() {
  const { track, isPlaying, currentTime, duration, togglePlayback, isBuffering, isLoaded } =
    useNowPlaying()

  const router = useRouter()
  const colors = useThemeColors()
  const placement = NativeTabs.BottomAccessory.usePlacement()
  const accent = colors.accent

  if (!track) return null

  const playGlyph = isPlaying ? 'pause' : 'play'
  const showSpinner = isBuffering || !isLoaded

  if (placement === 'inline') {
    return (
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 10,
        }}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Open now playing: ${track.title}`}
          onPress={() => router.push('/now-playing')}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Artwork url={track.thumbnailUrl} size={26} colors={colors} />
          <Text
            style={{ flex: 1, color: textColor, fontFamily: fonts.monoSemiBold, fontSize: 12 }}
            numberOfLines={1}>
            {track.title}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={showSpinner ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
          hitSlop={8}
          onPress={togglePlayback}
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          {showSpinner ? (
            <ActivityIndicator size='small' color={textColor} />
          ) : (
            <Glyph name={playGlyph} size={16} color={textColor} />
          )}
        </Pressable>
      </View>
    )
  }

  const creatorNames = track.creators?.map((creator) => creator.name).join(', ')
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 12,
        }}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Open now playing: ${track.title}`}
          onPress={() => router.push('/now-playing')}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Artwork url={track.thumbnailUrl} size={40} colors={colors} />
          <View style={{ flex: 1 }}>
            <Text
              style={{ color: textColor, fontFamily: fonts.monoSemiBold, fontSize: 14 }}
              numberOfLines={1}>
              {track.title}
            </Text>
            {creatorNames ? (
              <Text
                style={{ color: textColor, opacity: 0.55, fontFamily: fonts.mono, fontSize: 11 }}
                numberOfLines={1}>
                {creatorNames}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={showSpinner ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
          hitSlop={8}
          onPress={togglePlayback}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          {showSpinner ? (
            <ActivityIndicator size='small' color={textColor} />
          ) : (
            <Glyph name={playGlyph} size={22} color={textColor} />
          )}
        </Pressable>
      </View>
      {progress > 0 ? (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 12,
            right: 12,
            height: 2,
            borderRadius: radii.control,
            overflow: 'hidden',
            backgroundColor:
              Platform.OS === 'ios'
                ? dynamicColorIOS({
                    dark: brandDark.faintOverlayText,
                    light: colors.faintOverlayText,
                  })
                : colors.faintOverlayText,
          }}>
          <View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: accent }} />
        </View>
      ) : null}
    </View>
  )
}
