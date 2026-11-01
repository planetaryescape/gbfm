import { radii } from '@gbfm/theme'
import { useRouter } from 'expo-router'
import { useRef } from 'react'
import type { AccessibilityActionEvent, LayoutChangeEvent } from 'react-native'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'

import { useNowPlaying } from '@/audio/NowPlayingProvider'
import { NowPlayingTitle } from '@/components/NowPlaying/NowPlayingTitle'
import { PlayerSheetHeader } from '@/components/NowPlaying/PlayerSheetHeader'
import { QueueSheet } from '@/components/NowPlaying/QueueSheet'
import { Screen } from '@/components/Screen'
import { Glyph } from '@/icons/Glyph'
import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

const SEEK_STEP_SECONDS = 15

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)

  return `${mins}:${secs.toString().padStart(2, '0')}`
}

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
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0
  const scrubWidthRef = useRef(0)
  const displayTrack = track ?? queue.current

  const handleScrubLayout = (event: LayoutChangeEvent) => {
    scrubWidthRef.current = event.nativeEvent.layout.width
  }

  const handleScrub = (x: number) => {
    const width = scrubWidthRef.current

    if (width > 0 && duration > 0) {
      const ratio = Math.max(0, Math.min(1, x / width))
      seekTo(ratio * duration)
    }
  }

  const handleScrubAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') {
      seekTo(Math.min(duration, currentTime + SEEK_STEP_SECONDS))
    } else if (event.nativeEvent.actionName === 'decrement') {
      seekTo(Math.max(0, currentTime - SEEK_STEP_SECONDS))
    }
  }

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

            <View style={{ gap: 6 }}>
              <Pressable
                accessibilityRole='adjustable'
                accessibilityLabel='Playback position'
                accessibilityHint='Tap to seek, or swipe up and down to seek 15 seconds'
                accessibilityValue={{
                  min: 0,
                  max: Math.max(0, Math.round(duration)),
                  now: Math.max(0, Math.min(Math.round(duration), Math.round(currentTime))),
                  text: `${formatTime(currentTime)} of ${formatTime(duration)}`,
                }}
                accessibilityActions={[
                  { name: 'increment', label: 'Seek forward 15 seconds' },
                  { name: 'decrement', label: 'Seek backward 15 seconds' },
                ]}
                onAccessibilityAction={handleScrubAccessibilityAction}
                onPress={(event) => handleScrub(event.nativeEvent.locationX)}
                onLayout={handleScrubLayout}
                style={({ pressed }) => ({
                  height: 44,
                  justifyContent: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}>
                <View
                  style={{
                    height: 4,
                    backgroundColor: withAlpha(colors.muted, 0.3),
                    borderRadius: 2,
                  }}>
                  <View
                    style={{
                      height: '100%',
                      width: `${progress * 100}%`,
                      borderRadius: 2,
                      backgroundColor: colors.accent,
                    }}
                  />
                </View>
                <View
                  style={{
                    position: 'absolute',
                    left: `${progress * 100}%`,
                    marginLeft: -7,
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: colors.accent,
                    borderWidth: 2,
                    borderColor: colors.background,
                  }}
                />
              </Pressable>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>
                  {formatTime(currentTime)}
                </Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>
                  {formatTime(duration)}
                </Text>
              </View>
            </View>

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
