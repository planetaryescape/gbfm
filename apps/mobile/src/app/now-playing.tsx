import { radii } from '@gbfm/theme'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'

import { useNowPlaying } from '@/audio/NowPlayingProvider'
import { HillScrubber } from '@/components/NowPlaying/HillScrubber'
import { NowPlayingTitle } from '@/components/NowPlaying/NowPlayingTitle'
import { PlayerSheetHeader } from '@/components/NowPlaying/PlayerSheetHeader'
import { QueueSheet } from '@/components/NowPlaying/QueueSheet'
import { Screen } from '@/components/Screen'
import { Glyph } from '@/icons/Glyph'
import { useThemeColors, withAlpha } from '@/theme/colors'

export default function NowPlaying() {
  const {
    track,
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    togglePlayback,
    seekTo,
    skipNext,
    skipPrevious,
    queue,
  } = useNowPlaying()

  const router = useRouter()
  const colors = useThemeColors()

  const canSkipPrev = queue.currentIndex > 0
  const canSkipNext = queue.currentIndex >= 0 && queue.currentIndex + 1 < queue.tracks.length
  const displayTrack = track ?? queue.current

  return (
    <Screen>
      <PlayerSheetHeader onClose={() => router.back()} />

      {!displayTrack ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: colors.text, fontSize: 16, textAlign: 'center' }}>
            Nothing playing yet. Pick a mix from Home to get started.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 8, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}>
          <View style={{ width: '100%', maxWidth: 340, alignSelf: 'center', gap: 24 }}>
            <View
              style={{
                aspectRatio: 1,
                borderRadius: radii.artwork,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: withAlpha(colors.accent, 0.2),
                backgroundColor: colors.surface,
                shadowColor: colors.shadow,
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.25,
                shadowRadius: 16,
                elevation: 6,
              }}>
              {displayTrack.thumbnailUrl ? (
                <Image
                  source={{ uri: displayTrack.thumbnailUrl }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode='cover'
                />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Glyph name='sleeve' size={48} color={withAlpha(colors.muted, 0.6)} />
                </View>
              )}
            </View>

            <NowPlayingTitle track={displayTrack} />

            <HillScrubber
              key={displayTrack.id}
              currentTime={currentTime}
              duration={duration}
              onSeek={seekTo}
            />

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 40,
              }}>
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Previous track'
                disabled={!canSkipPrev}
                hitSlop={12}
                onPress={skipPrevious}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: !canSkipPrev ? 0.35 : pressed ? 0.6 : 1,
                })}>
                <Glyph name='previous' size={26} color={colors.accent} />
              </Pressable>

              <Pressable
                accessibilityRole='button'
                accessibilityLabel={isBuffering ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
                onPress={togglePlayback}
                style={({ pressed }) => ({
                  width: 72,
                  height: 72,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radii.round,
                  backgroundColor: colors.controls.primary,
                  opacity: pressed ? 0.85 : 1,
                })}>
                {isBuffering ? (
                  <ActivityIndicator size='large' color={colors.controls.primaryForeground} />
                ) : (
                  <Glyph
                    name={isPlaying ? 'pause' : 'play'}
                    size={30}
                    color={colors.controls.primaryForeground}
                  />
                )}
              </Pressable>

              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Next track'
                disabled={!canSkipNext}
                hitSlop={12}
                onPress={skipNext}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: !canSkipNext ? 0.35 : pressed ? 0.6 : 1,
                })}>
                <Glyph name='next' size={26} color={colors.accent} />
              </Pressable>
            </View>

            <QueueSheet />
          </View>
        </ScrollView>
      )}
    </Screen>
  )
}
