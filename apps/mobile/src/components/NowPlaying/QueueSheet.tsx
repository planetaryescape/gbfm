import { radii } from '@gbfm/theme'
import { useState } from 'react'
import { FlatList, Image, Modal, Pressable, Text, View } from 'react-native'

import { useNowPlaying } from '@/audio/NowPlayingProvider'
import { Button } from '@/components/Button'
import { Glyph } from '@/icons/Glyph'
import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export function QueueSheet() {
  const { queue, skipTo, removeFromQueue } = useNowPlaying()
  const colors = useThemeColors()
  const [isOpen, setIsOpen] = useState(false)

  const queueLength = queue.tracks.length
  const queueLabel = `Queue${queueLength > 0 ? ` · ${queueLength}` : ''}`

  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Open queue'
        hitSlop={8}
        onPress={() => setIsOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 6,
          paddingHorizontal: 2,
          opacity: pressed ? 0.6 : 1,
        })}>
        <Text
          style={{
            color: colors.muted,
            fontFamily: fonts.monoSemiBold,
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 2,
          }}>
          {queueLabel}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ color: colors.accent, fontFamily: fonts.monoSemiBold, fontSize: 12 }}>
            Open
          </Text>
          <Glyph name='chevronUp' size={12} color={colors.accent} />
        </View>
      </Pressable>

      {queueLength > 0 ? (
        <View style={{ gap: 4 }}>
          {queue.tracks
            .slice(Math.max(0, queue.currentIndex), queue.currentIndex + 2)
            .map((track) => {
              const isCurrent = track.id === queue.current?.id

              return (
                <View
                  key={track.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 8,
                    borderRadius: radii.surface,
                    backgroundColor: isCurrent ? withAlpha(colors.accent, 0.12) : 'transparent',
                  }}>
                  {track.thumbnailUrl ? (
                    <Image
                      source={{ uri: track.thumbnailUrl }}
                      style={{ width: 36, height: 36, borderRadius: radii.artwork }}
                      resizeMode='cover'
                    />
                  ) : (
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: radii.artwork,
                        backgroundColor: withAlpha(colors.muted, 0.2),
                      }}
                    />
                  )}
                  <Text
                    style={{
                      flex: 1,
                      color: isCurrent ? colors.accent : colors.strong,
                      fontFamily: fonts.monoSemiBold,
                      fontSize: 12,
                    }}
                    numberOfLines={1}>
                    {track.title}
                  </Text>
                  {isCurrent ? (
                    <Text
                      style={{
                        color: colors.accent,
                        fontFamily: fonts.mono,
                        fontSize: 9,
                        letterSpacing: 1.5,
                      }}>
                      PLAYING
                    </Text>
                  ) : null}
                </View>
              )
            })}
        </View>
      ) : (
        <Text
          style={{
            color: withAlpha(colors.muted, 0.75),
            fontFamily: fonts.mono,
            fontSize: 12,
            paddingHorizontal: 2,
          }}>
          Your queue is empty.
        </Text>
      )}

      <Modal
        visible={isOpen}
        animationType='slide'
        presentationStyle='pageSheet'
        onRequestClose={() => setIsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingTop: 18,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: withAlpha(colors.muted, 0.25),
            }}>
            <Text
              style={{
                color: colors.strong,
                fontFamily: fonts.monoSemiBold,
                fontSize: 16,
              }}>
              {queueLabel}
            </Text>
            <Button label='Done' variant='quiet' onPress={() => setIsOpen(false)} />
          </View>

          {queueLength === 0 ? (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 32,
                gap: 8,
              }}>
              <Text
                style={{
                  color: colors.muted,
                  fontFamily: fonts.monoSemiBold,
                  fontSize: 16,
                  textAlign: 'center',
                }}>
                Nothing queued yet
              </Text>
              <Text
                style={{
                  color: withAlpha(colors.text, 0.6),
                  fontFamily: fonts.mono,
                  fontSize: 12,
                  textAlign: 'center',
                }}>
                Add tracks from a show or mix to build your queue.
              </Text>
            </View>
          ) : (
            <FlatList
              data={queue.tracks}
              keyExtractor={(track, index) => `${track.id}-${index}`}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 12, gap: 4 }}
              initialNumToRender={12}
              windowSize={7}
              renderItem={({ item: track, index }) => {
                const isCurrent = index === queue.currentIndex

                return (
                  <View
                    key={track.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      padding: 10,
                      borderRadius: radii.surface,
                      backgroundColor: isCurrent ? withAlpha(colors.accent, 0.14) : colors.surface,
                    }}>
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel={`${isCurrent ? 'Current track' : 'Play'}: ${track.title}`}
                      hitSlop={8}
                      onPress={() => {
                        skipTo(index)
                        setIsOpen(false)
                      }}
                      style={({ pressed }) => ({
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        opacity: pressed ? 0.7 : 1,
                      })}>
                      {track.thumbnailUrl ? (
                        <Image
                          source={{ uri: track.thumbnailUrl }}
                          style={{ width: 44, height: 44, borderRadius: radii.artwork }}
                          resizeMode='cover'
                        />
                      ) : (
                        <View
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 6,
                            backgroundColor: withAlpha(colors.muted, 0.25),
                          }}
                        />
                      )}
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text
                          style={{
                            color: isCurrent ? colors.accent : colors.strong,
                            fontFamily: fonts.monoSemiBold,
                            fontSize: 14,
                          }}
                          numberOfLines={1}>
                          {track.title}
                        </Text>
                        <Text
                          style={{
                            color: colors.muted,
                            fontFamily: fonts.mono,
                            fontSize: 11,
                          }}
                          numberOfLines={1}>
                          {track.creators?.map((c) => c.name).join(', ') ?? track.type}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel={`Remove ${track.title} from queue`}
                      hitSlop={8}
                      onPress={() => removeFromQueue(index)}
                      style={({ pressed }) => ({
                        width: 30,
                        height: 30,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 15,
                        backgroundColor: withAlpha(colors.muted, 0.18),
                        opacity: pressed ? 0.6 : 1,
                      })}>
                      <Glyph name='close' size={12} color={colors.muted} />
                    </Pressable>
                  </View>
                )
              }}
            />
          )}
        </View>
      </Modal>
    </View>
  )
}
