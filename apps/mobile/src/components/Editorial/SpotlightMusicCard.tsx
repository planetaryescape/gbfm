import type { RichContentBlock } from '@gbfm/rich-content/schema'
import { useState } from 'react'
import { Image, Linking, Pressable, Text, View } from 'react-native'

import { SpotifyEntityActions } from '@/spotify/SpotifyEntityActions'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { SquareFrame } from './SquareFrame'

type MusicEmbed = Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>

const platformLabels = new Map([
  ['spotify', 'Spotify'],
  ['deezer', 'Deezer'],
  ['bandcamp', 'Bandcamp'],
  ['apple_music', 'Apple Music'],
  ['youtube', 'YouTube'],
  ['youtube_music', 'YT Music'],
  ['tidal', 'Tidal'],
  ['soundcloud', 'SoundCloud'],
])

type Props = { readonly block: MusicEmbed; readonly compact?: boolean }

export function SpotlightMusicCard({ block, compact = false }: Props) {
  const colors = useThemeColors()
  const [notice, setNotice] = useState('')
  const { music, blurb } = block
  const spotify = music.links.find((link) => link.platform === 'spotify')
  const links = music.links.filter((link) => platformLabels.has(link.platform))
  const divider = { borderTopWidth: 2, borderColor: colors.strong }

  return (
    <SquareFrame style={compact ? { width: 220 } : undefined}>
      <View style={{ flexDirection: compact ? 'column' : 'row', gap: 12, padding: 12 }}>
        {music.imageUrl ? (
          <Image
            source={{ uri: music.imageUrl }}
            accessibilityLabel={`Artwork for ${music.title}`}
            style={{
              width: compact ? '100%' : 104,
              aspectRatio: 1,
              borderWidth: 2,
              borderColor: colors.strong,
            }}
          />
        ) : null}
        <View style={{ flex: compact ? undefined : 1, gap: 4 }}>
          <Text
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: 6,
              paddingVertical: 2,
              backgroundColor: colors.strong,
              color: colors.surface,
              fontFamily: fonts.monoSemiBold,
              fontSize: 10,
              letterSpacing: 1.6,
              textTransform: 'uppercase',
            }}>
            {music.entityType}
          </Text>
          <Text style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 17 }}>
            {music.title}
          </Text>
          {music.artists.length > 0 ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 13 }}>
              {music.artists.join(', ')}
            </Text>
          ) : null}
        </View>
      </View>
      {blurb ? (
        <View style={[divider, { padding: 12, backgroundColor: `${colors.accent}1a` }]}>
          <Text
            style={{ color: colors.strong, fontFamily: fonts.mono, fontSize: 14, lineHeight: 21 }}>
            <Text style={{ color: colors.accent }}>▸ </Text>
            {blurb}
          </Text>
        </View>
      ) : null}
      {spotify ? (
        <View style={[divider, { padding: 12, gap: 6 }]}>
          <SpotifyEntityActions url={spotify.url} onNotice={setNotice} />
          {notice ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
              {notice}
            </Text>
          ) : null}
        </View>
      ) : null}
      {links.length > 0 ? (
        <View style={[divider, { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 }]}>
          {links.map((link) => (
            <Pressable
              key={link.url}
              accessibilityRole='link'
              onPress={() => void Linking.openURL(link.url)}
              style={{
                borderWidth: 2,
                borderColor: colors.strong,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}>
              <Text
                style={{
                  color: colors.strong,
                  fontFamily: fonts.monoSemiBold,
                  fontSize: 11,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase',
                }}>
                {platformLabels.get(link.platform)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </SquareFrame>
  )
}
