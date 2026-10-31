import type { AudioResponse } from '@gbfm/api/audio'
import { LinearGradient } from 'expo-linear-gradient'
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native'

import { Glyph } from '@/icons/Glyph'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

// Fixed geometry, mirrored by FeaturedMixSkeleton, so that
// loading -> loaded/error never shifts layout.
export const FEATURED_CARD_INFO_HEIGHT = 64

export const FEATURED_CARD_BUTTON_HEIGHT = 52

export function FeaturedMixCard({
  mix,
  isPlaying = false,
  isCurrent = false,
  isLoading = false,
  onPressPlay,
  onRetry,
}: {
  mix: typeof AudioResponse.Type | null
  isPlaying?: boolean
  isCurrent?: boolean
  isLoading?: boolean
  onPressPlay: () => void
  onRetry?: () => void
}) {
  const colors = useThemeColors()

  const cardContainerStyle = {
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  } as const

  if (!mix) {
    return (
      <View style={{ ...cardContainerStyle, borderColor: colors.muted }}>
        <View
          style={{
            aspectRatio: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
          }}>
          <Glyph name='warning' size={32} color={colors.muted} />
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.mono,
              fontSize: 14,
              textAlign: 'center',
            }}>
            couldn't load the featured mix
          </Text>
        </View>
        <View
          style={{
            height: FEATURED_CARD_INFO_HEIGHT,
            justifyContent: 'center',
            paddingHorizontal: 16,
          }}>
          <Text style={{ color: colors.text, fontFamily: fonts.mono, fontSize: 14 }}>
            check your connection and try again
          </Text>
        </View>
        <Pressable
          accessibilityRole='button'
          onPress={onRetry}
          style={({ pressed }) => ({
            height: FEATURED_CARD_BUTTON_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accent,
            opacity: pressed ? 0.85 : 1,
          })}>
          <Text
            style={{
              color: colors.surface,
              fontFamily: fonts.monoSemiBold,
              fontSize: 15,
              letterSpacing: 0.5,
            }}>
            Retry
          </Text>
        </Pressable>
      </View>
    )
  }

  const creatorNames = (mix.artists?.length ? mix.artists : mix.creators)
    ?.map((creator) => creator.name)
    .join(', ')

  return (
    <View style={cardContainerStyle}>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={isPlaying ? 'Pause featured mix' : 'Play featured mix'}
        onPress={onPressPlay}
        disabled={isLoading}
        style={({ pressed }) => ({ aspectRatio: 1, opacity: pressed ? 0.92 : 1 })}>
        {mix.thumbnailUrl ? (
          <Image
            source={{ uri: mix.thumbnailUrl }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            resizeMode='cover'
          />
        ) : null}

        <LinearGradient
          pointerEvents='none'
          colors={['rgba(0,0,0,0.45)', 'transparent']}
          locations={[0, 0.35]}
          style={{ position: 'absolute', inset: 0 }}
        />

        <Text
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            backgroundColor: colors.accent,
            color: colors.surface,
            fontFamily: fonts.monoSemiBold,
            fontSize: 12,
            letterSpacing: 3,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 2,
          }}>
          {isPlaying ? 'Now Playing' : 'Featured'}
        </Text>
      </Pressable>

      <View
        style={{
          height: FEATURED_CARD_INFO_HEIGHT,
          justifyContent: 'center',
          gap: 4,
          paddingHorizontal: 16,
        }}>
        <Text
          style={{
            color: colors.strong,
            fontFamily: fonts.monoSemiBold,
            fontSize: 20,
            lineHeight: 24,
          }}
          numberOfLines={1}>
          {mix.title}
        </Text>
        <Text
          style={{ color: colors.text, fontFamily: fonts.mono, fontSize: 14, lineHeight: 18 }}
          numberOfLines={1}>
          {creatorNames ?? ''}
        </Text>
      </View>

      <Pressable
        accessibilityRole='button'
        onPress={onPressPlay}
        disabled={isLoading}
        style={({ pressed }) => ({
          height: FEATURED_CARD_BUTTON_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          backgroundColor: colors.accent,
          opacity: pressed ? 0.85 : 1,
        })}>
        {isLoading ? (
          <>
            <ActivityIndicator size='small' color={colors.surface} />
            <Text
              style={{
                color: colors.surface,
                fontFamily: fonts.monoSemiBold,
                fontSize: 15,
                letterSpacing: 0.5,
              }}>
              Loading
            </Text>
          </>
        ) : (
          <>
            <Glyph name={isPlaying ? 'pause' : 'play'} size={16} color={colors.surface} />
            <Text
              style={{
                color: colors.surface,
                fontFamily: fonts.monoSemiBold,
                fontSize: 15,
                letterSpacing: 0.5,
              }}>
              {isPlaying ? 'Pause' : isCurrent ? 'Resume' : 'Play'}
            </Text>
          </>
        )}
      </Pressable>
    </View>
  )
}
