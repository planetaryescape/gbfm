import { radii } from '@gbfm/theme'
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native'

import { Glyph } from '@/icons/Glyph'
import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import type { MusicAttachment } from '@/tweets/draft'

const COVER_SIZE = 56

export function ComposerMusicPreview({
  music,
  loading,
  onDismiss,
}: {
  readonly music: MusicAttachment | null
  readonly loading: boolean
  readonly onDismiss: (() => void) | undefined
}) {
  const colors = useThemeColors()

  if (!music && !loading) return null

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 10,
        borderRadius: radii.surface,
        borderWidth: 1,
        borderColor: withAlpha(colors.muted, 0.35),
        backgroundColor: colors.surface,
      }}>
      {music?.coverImageUrl ? (
        <Image
          source={{ uri: music.coverImageUrl }}
          accessibilityLabel={`${music.title} cover`}
          style={{ width: COVER_SIZE, height: COVER_SIZE, borderRadius: radii.artwork }}
        />
      ) : (
        <View
          style={{
            width: COVER_SIZE,
            height: COVER_SIZE,
            borderRadius: radii.artwork,
            backgroundColor: colors.accentSurface,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {loading ? <ActivityIndicator color={colors.accent} /> : null}
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>
          {music ? music.entityType : 'finding music…'}
        </Text>
        {music ? (
          <Text
            numberOfLines={2}
            style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 14 }}>
            {music.title}
          </Text>
        ) : null}
      </View>
      {music && onDismiss ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Remove music card'
          hitSlop={10}
          onPress={onDismiss}
          style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
          <Glyph name='close' size={16} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  )
}
